// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useCallback, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { 相册系统 } from '@/models/imageGeneration';
import { 创建空相册系统 } from '@/models/imageGeneration';
import { 创建相册资源引用 } from '@/utils/albumActions';
import { 创建空角色 } from '@/models/character';
import { 创建默认游戏设置 } from '@/models/settings';
import { clearAlbumAssetObjectUrlCache } from '@/utils/albumObjectUrl';
import type { NPC记录 } from '@/models/npc';

/**
 * P1-B03：上传参考图会丢掉等待期间的新相册内容。
 *
 * 复现（审查者 handler 内存复现）：文件读取 / hash / hydrate 多次 await 之后，
 * 用**闭包旧 album** 派生的整份对象覆盖当前相册 —— 等待期间新增的生成图片在上传结束后消失。
 *
 * 修复要求：准备数据与最终提交分离，最终**基于当前相册函数式合并**（`setAlbum(prev => ...)`）。
 * 本文件用真实 `AlbumPanel`（jsdom）驱动真实 handler，只把摘要计算换成可控 deferred，
 * 以便在上传等待期间插入一次「生成完成」的相册提交。
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/services/ai/imageGeneration', () => ({
  generateImage: vi.fn(),
  buildNovelAIRequestPayload: () => ({}),
}));
vi.mock('@/services/ai/characterAnchorExtract', () => ({ extractCharacterAnchorWithAI: vi.fn() }));

const { AlbumPanel } = await import('@/components/features/GameSystems/AlbumPanel');

const TRAVELER = { ...创建空角色(), id: 'traveler', 姓名: '云', 性别: '女', 图像档案: {} };
const NPC: NPC记录 = {
  id: 'npc_amber', 姓名: '安柏', 阶位: 'companion', 好感度: 0, 关系: 'stranger',
  亲密关系: false, 同行: false, 初见回合: 1, 最近回合: 1, 性别: '女', 备注: [], 图像档案: {},
} as NPC记录;

const imageSettings = () => {
  const settings = 创建默认游戏设置();
  settings.文生图系统.enabled = true;
  settings.文生图系统.普通接口 = {
    ...settings.文生图系统.普通接口,
    enabled: true, baseUrl: 'https://image.example/v1', apiKey: 'k', model: 'm', retryCount: 0,
  };
  return settings.文生图系统;
};

const gameSettings = 创建默认游戏设置();

/** 已有资源：没有 contentHash 但有 inline dataUrl → hydrate 必须去算摘要（我们的可控等待点）。 */
function albumWithLegacyAsset(): 相册系统 {
  return {
    assets: [{
      id: 'asset_legacy', dataUrl: 'data:image/png;base64,TlBQ', source: 'generated',
      nsfw: false, createdAt: 1, status: 'ready',
    }],
    entries: [{
      id: 'album_legacy', assetId: 'asset_legacy', title: '旧图', targetType: 'misc',
      slot: 'misc', tags: [], nsfw: false, createdAt: 1, referenceTargets: [],
    }],
    tasks: [],
  };
}

let album: 相册系统 = 创建空相册系统();
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function Host() {
  const [, forceRender] = useReducer((tick: number) => tick + 1, 0);
  const commit = useCallback((action: unknown) => {
    const previous = album;
    const next = typeof action === 'function'
      ? (action as (value: unknown) => unknown)(previous)
      : action;
    if (next === previous) return;
    album = next as 相册系统;
    forceRender();
  }, []);
  return createElement(AlbumPanel as never, {
    album,
    onAlbumChange: commit,
    traveler: TRAVELER,
    onTravelerChange: () => undefined,
    npcs: [NPC],
    onNpcChange: () => undefined,
    apiSettings: { activeConfigId: 'c', configs: [] },
    gameSettings,
    onGameSettingsChange: () => undefined,
    imageSettings: imageSettings(),
    nsfwEnabled: false,
    nsfwImageEnabled: false,
    mainChatHistory: [],
    getGameSessionId: () => 1,
  } as never);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const digestCalls: Array<(value: ArrayBuffer) => void> = [];
let digestSeed = 0;
/** 每次摘要返回**不同**字节：否则旧资源与上传文件会算出同一个 hash 而被当成同一张图。 */
const digestBytes = (seed: number) => {
  const bytes = new Uint8Array(32);
  bytes.fill(seed % 251);
  return bytes.buffer;
};

/**
 * 放行挂起的摘要计算。
 *
 * 上传路径有**两次**摘要：先算上传文件自己的 hash，再在 `hydrateAlbumContentHashes` 里
 * 算旧资源的 hash。只放行前 N 次才能把流程停在 hydrate 上，从而插入并发修改。
 */
async function drainDigests(action: { flush: () => Promise<void> }, only?: number) {
  const pending = only === undefined ? digestCalls.splice(0) : digestCalls.splice(0, only);
  for (const resolve of pending) {
    digestSeed += 7;
    resolve(digestBytes(digestSeed));
  }
  await action.flush();
}

describe('B03 上传参考图必须函数式合并当前相册', () => {
  const flush = async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };

  beforeEach(async () => {
    clearAlbumAssetObjectUrlCache();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => `blob:mock-${Math.random().toString(36).slice(2)}`),
      revokeObjectURL: vi.fn(),
    });
    // 摘要计算换成可控 deferred：上传会停在 hydrate 的 sha256 上。
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      ...realCrypto,
      subtle: {
        ...realCrypto?.subtle,
        digest: vi.fn(() => new Promise<ArrayBuffer>((resolve) => { digestCalls.push(resolve); })),
      },
    });
    digestCalls.length = 0;
    album = albumWithLegacyAsset();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(Host)); });
    // 打开「图库」工作区（沿用真实导航：子页签 textContent 含序号与说明）。
    const galleryTab = Array.from(document.querySelectorAll('button'))
      .find((candidate) => candidate.textContent?.includes('图库'));
    if (!galleryTab) throw new Error('找不到「图库」页签');
    await act(async () => { galleryTab.click(); });
    await flush();
  });

  afterEach(async () => {
    // 放行所有挂起的摘要，避免把 promise 泄漏到下一个用例。
    for (const resolve of digestCalls.splice(0)) { digestSeed += 7; resolve(digestBytes(digestSeed)); }
    if (root) { const mounted = root; await act(async () => { mounted.unmount(); }); }
    host?.remove();
    root = null;
    host = null;
    clearAlbumAssetObjectUrlCache();
    vi.unstubAllGlobals();
  });

  /** 选文件 + 只放行「上传文件自己的 hash」，让流程停在 hydrate 的摘要上。 */
  async function beginUploadAndParkAtHydrate(bytes: number[]) {
    const input = document.querySelector('input[type="file"][accept="image/*"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('找不到参考图上传输入框');
    const file = new File([new Uint8Array(bytes)], 'ref.png', { type: 'image/png' });
    await act(async () => {
      Object.defineProperty(input, 'files', {
        value: { 0: file, length: 1, item: (index: number) => (index === 0 ? file : null) },
        configurable: true,
      });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    // 第一次摘要 = 上传文件自身的 contentHash。
    await drainDigests({ flush }, 1);
    await flush();
    // 现在应当停在 hydrate 里旧资源的摘要上。
    expect(digestCalls.length).toBeGreaterThan(0);
  }

  /** 在上传等待期间发生的「另一次相册提交」：生成完成，加入一条新图片。 */
  const commitGeneratedImageWhileWaiting = async () => {
    await act(async () => {
      album = {
        ...album,
        assets: [{
          id: 'asset_generated', dataUrl: 创建相册资源引用('asset_generated'), source: 'generated',
          nsfw: false, createdAt: 9, status: 'ready',
        }, ...album.assets],
        entries: [{
          id: 'album_generated', assetId: 'asset_generated', title: '等待期间生成的图', targetType: 'misc',
          slot: 'misc', tags: [], nsfw: false, createdAt: 9, referenceTargets: [],
        }, ...album.entries],
      };
      root!.render(createElement(Host));
    });
  };

  it('上传与生成交错完成：双方结果都保留', async () => {
    await beginUploadAndParkAtHydrate([1, 2, 3, 4]);

    // 上传卡在摘要计算时，另一条路径完成了生成并提交进相册。
    await commitGeneratedImageWhileWaiting();
    expect(album.entries.some((entry) => entry.id === 'album_generated')).toBe(true);

    // 放行摘要 → 上传的最终提交。
    await drainDigests({ flush });
    await flush();
    await flush();

    const titles = album.entries.map((entry) => entry.title);
    expect(titles).toContain('等待期间生成的图');
    expect(titles.some((title) => title.includes('参考图'))).toBe(true);
    expect(titles).toContain('旧图');
  });

  it('上传期间删除参考图：删除结果与上传结果都保留', async () => {
    await beginUploadAndParkAtHydrate([9, 9]);

    // 等待期间删除旧图（另一条并发编辑）。
    await act(async () => {
      album = { ...album, entries: album.entries.filter((entry) => entry.id !== 'album_legacy') };
      root!.render(createElement(Host));
    });

    await drainDigests({ flush });
    await flush();
    await flush();

    const titles = album.entries.map((entry) => entry.title);
    expect(titles).not.toContain('旧图');
    expect(titles.some((title) => title.includes('参考图'))).toBe(true);
  });
});

