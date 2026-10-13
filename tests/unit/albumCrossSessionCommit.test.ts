// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, StrictMode, useCallback, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { 相册系统 } from '@/models/imageGeneration';
import type { 角色数据结构 } from '@/models/character';
import type { NPC记录 } from '@/models/npc';
import { 创建空相册系统 } from '@/models/imageGeneration';
import { 创建空角色 } from '@/models/character';
import { 创建默认游戏设置 } from '@/models/settings';
import { clearAlbumAssetObjectUrlCache } from '@/utils/albumObjectUrl';
import { chatCompletionNonStream } from '@/services/ai/chatCompletionClient';

/**
 * P1-B02：相册手动生图完成后**不得**把结果写进另一个存档。
 *
 * 复现（审查者用真实 handler 内存复现）：A 档启动手动生图 → 关闭相册/切到 B 档 →
 * A 的请求完成 → 完成回调直接调用稳定 setter，写进「当前」根，也就是 B 档：
 * B 拿到 A 的图片，却没有对应任务记录。
 *
 * 修复要求：任务记录绑定 session，提交前核对身份；旧任务结果留在原档任务区或丢弃，**不可写 B**。
 * 本文件用真实 `AlbumPanel`（jsdom + react-dom/client）驱动真实 handler，
 * 只把「服务端生图」与「AI 锚点提取」两处网络出口替换为可控的 deferred。
 * 由于 props 是按「当前档」渲染的，异步回调必须比对启动时捕获的 session 才能知道该不该提交。
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const generateImageMock = vi.fn();
const extractAnchorMock = vi.fn();
let usePromptModel = false;
let useQualityPreset = false;
let useStrictMode = false;
let imageApiEnabled = true;
const { englishStore } = vi.hoisted(() => ({ englishStore: new Map<string, unknown>() }));
vi.mock('@/services/dbService', async importOriginal => ({ ...await importOriginal<object>(),
  loadSetting: async (key: string) => englishStore.get(key) ?? null,
  saveSetting: async (key: string, value: unknown) => { englishStore.set(key, value); },
}));

vi.mock('@/services/ai/imageGeneration', () => ({
  generateImage: (...args: unknown[]) => generateImageMock(...args),
  buildNovelAIRequestPayload: () => ({}),
}));
vi.mock('@/services/ai/characterAnchorExtract', () => ({
  extractCharacterAnchorWithAI: (...args: unknown[]) => extractAnchorMock(...args),
}));
vi.mock('@/services/ai/chatCompletionClient', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/ai/chatCompletionClient')>(),
  chatCompletionNonStream: vi.fn(async () => { throw new Error('offline prompt test'); }),
}));

const { AlbumPanel } = await import('@/components/features/GameSystems/AlbumPanel');

const traveler = (): 角色数据结构 => ({ ...创建空角色(), id: 'traveler', 姓名: '云', 性别: '女', 图像档案: {} });

const amber = (): NPC记录 => ({
  id: 'npc_amber', 姓名: '安柏', 阶位: 'companion', 好感度: 0, 关系: 'stranger',
  亲密关系: false, 同行: false, 初见回合: 1, 最近回合: 1, 性别: '女', 备注: [], 图像档案: {},
} as NPC记录);

const imageGameSettings = () => {
  const settings = 创建默认游戏设置();
  settings.文生图系统.enabled = true;
  settings.文生图系统.enablePromptTokenizer = usePromptModel;
  if (useQualityPreset) {
    settings.文生图系统.rules.质量增强预设列表 = [{ id: 'test-quality', 名称: '测试画风', 正面提示词: 'fine watercolor paper grain', 负面提示词: 'weak lighting', createdAt: 1, updatedAt: 1 }];
    settings.文生图系统.rules.当前质量增强预设ID = 'test-quality';
  }
  settings.文生图系统.普通接口 = {
    ...settings.文生图系统.普通接口,
    enabled: imageApiEnabled,
    baseUrl: 'https://image.example/v1',
    apiKey: 'test-key',
    model: 'image-model',
    retryCount: 0,
  };
  return settings;
};

interface SessionSlot {
  album: { current: 相册系统 };
  traveler: { current: 角色数据结构 };
  npcs: { current: NPC记录[] };
}

function newSlot(): SessionSlot {
  return {
    album: { current: 创建空相册系统() },
    traveler: { current: traveler() },
    npcs: { current: [amber()] },
  };
}

/** 浅比较：生产里的 setter 在内容不变时也不会重渲染，测试宿主必须同样处理，否则自激循环。 */
function isShallowEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left as Record<string, unknown>);
  const rightKeys = Object.keys(right as Record<string, unknown>);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) =>
    (left as Record<string, unknown>)[key] === (right as Record<string, unknown>)[key]);
}

/** 双档宿主：模仿 useGameState 的单根结构 —— 提交动作来自「启动时那一次渲染」的闭包。 */
let sessionId = 1;
let sessions: Record<number, SessionSlot> = { 1: newSlot(), 2: newSlot() };
let bumpHostRender: () => void = () => undefined;

function AlbumHost() {
  const [, forceRender] = useReducer((tick: number) => tick + 1, 0);
  bumpHostRender = forceRender;
  const active = sessions[sessionId] ?? sessions[1]!;
  const commit = useCallback((slot: { current: unknown }, action: unknown) => {
    const previous = slot.current;
    const next = typeof action === 'function'
      ? (action as (value: unknown) => unknown)(previous)
      : action;
    if (next === previous || isShallowEqual(next, previous)) return;
    slot.current = next;
    forceRender();
  }, []);
  return createElement(AlbumPanel, {
    album: active.album.current,
    onAlbumChange: (action: unknown) => commit(active.album as { current: unknown }, action),
    onCommitGeneratedImage: (update: (current: { album: 相册系统; traveler: 角色数据结构; npcs: NPC记录[] }) => 相册系统, expected: number) => {
      if (expected !== sessionId) return false;
      const live = sessions[sessionId]!;
      const next = update({ album: live.album.current, traveler: live.traveler.current, npcs: live.npcs.current });
      if (next === live.album.current) return false;
      commit(live.album, next);
      return true;
    },
    onTravelerChange: (action: unknown) => commit(active.traveler as { current: unknown }, action),
    onNpcChange: (action: unknown) => commit(active.npcs as { current: unknown }, action),
    traveler: active.traveler.current,
    npcs: active.npcs.current,
    apiSettings: {
      activeConfigId: 'cfg_main',
      configs: [{
        id: 'cfg_main', name: '主模型', provider: 'openai', baseUrl: 'https://api.example/v1',
        apiKey: 'test-key', model: 'test-model', maxTokens: 1024, temperature: 0.7,
        retryCount: 0, updatedAt: 1,
      }],
    } as never,
    gameSettings: imageGameSettings(),
    onGameSettingsChange: () => undefined,
    imageSettings: imageGameSettings().文生图系统,
    nsfwEnabled: false,
    nsfwImageEnabled: false,
    mainChatHistory: [],
    getGameSessionId: () => sessionId,
  } as never);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function exactButton(label: string, classNameIncludes?: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((candidate) =>
    candidate.textContent?.trim() === label
    && (!classNameIncludes || candidate.className.includes(classNameIncludes)));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`找不到按钮：${label}`);
  return button;
}

/**
 * 打开「角色视觉」工作区。
 *
 * 子页签按钮的 `textContent` 是「序号 + 标题 + 说明」（`01角色视觉头像与立绘锚点`），
 * 不能用整串相等匹配，只能按标题包含匹配。
 */
async function openAnchorWorkspace(): Promise<void> {
  const anchorTab = Array.from(document.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.includes('角色视觉'));
  if (!anchorTab) throw new Error('找不到「角色视觉」页签');
  await act(async () => { anchorTab.click(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function selectByLabel(label: string): HTMLSelectElement {
  const select = Array.from(document.querySelectorAll('label'))
    .find((candidate) => candidate.textContent?.includes(label))
    ?.querySelector('select');
  if (!(select instanceof HTMLSelectElement)) throw new Error(`找不到下拉框：${label}`);
  return select;
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('B02 生图完成不得写进另一个存档', () => {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;
  /** 本用例里还没结算的生图 deferred：afterEach 必须放行，否则模块级队列被永久占位。 */
  let outstanding: { resolve: (value: { src: string }) => void } | null = null;

  const renderHost = async () => {
    if (!root) return;
    await act(async () => { root!.render(useStrictMode ? createElement(StrictMode, null, createElement(AlbumHost)) : createElement(AlbumHost)); });
  };
  const flush = async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };
  /** 排空微任务 + 定时器，让真实队列把任务推到终态（轮询而不是固定次数，避免时序抖动）。 */
  const settle = async (until?: () => boolean) => {
    for (let index = 0; index < 20; index += 1) {
      await act(async () => { await Promise.resolve(); });
      await flush();
      if (until && until()) return;
    }
  };
  const switchToSession = async (next: number) => {
    sessionId = next;
    await renderHost();
    await flush();
  };

  /**
   * 渲染宿主放在用例体内（不是 beforeEach）：
   * 异步 `act` 在 hook 里返回后其内部工作可能仍未排空，紧接着的 `root.render` 会被挂在
   * 「前一个 act 仍在进行」的状态上，测试表现为完全静默的挂死。
   */
  const mountPanel = async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await renderHost();
  };

  beforeEach(() => {
    clearAlbumAssetObjectUrlCache();
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => `blob:mock-${Math.random().toString(36).slice(2)}`),
      revokeObjectURL: vi.fn(),
    });
    generateImageMock.mockReset();
    extractAnchorMock.mockReset();
    usePromptModel = false;
    useQualityPreset = false;
    useStrictMode = false;
    imageApiEnabled = true;
    englishStore.clear();
    vi.mocked(chatCompletionNonStream).mockReset().mockImplementation(async (_config, request) => {
      if (!request.systemPrompt?.startsWith('Translate only')) throw new Error('offline prompt test');
      const source = JSON.parse(String(request.messages?.[0]?.content));
      return JSON.stringify({ ...source, name: source.name === '云' ? 'Yun' : 'Amber', gender: source.gender === '女' ? 'female' : source.gender });
    });
    sessionId = 1;
    sessions = { 1: newSlot(), 2: newSlot() };
  });

  afterEach(async () => {
    // 生图队列是模块级单例（并发 1）：用例里没结算的 deferred 会**永久占住**执行位，
    // 让后续用例的任务永远停在 queued。所以先把它放行、排空队列，再卸载。
    if (outstanding) {
      outstanding.resolve({ src: 'data:image/png;base64,QU1CRVI=' });
      outstanding = null;
      if (root) await settle();
    }
    if (root) {
      const mounted = root;
      await act(async () => { mounted.unmount(); });
    }
    host?.remove();
    root = null;
    host = null;
    // 先清缓存（需要 createObjectURL/revokeObjectURL 桩），再撤销全局桩。
    clearAlbumAssetObjectUrlCache();
    vi.unstubAllGlobals();
  });

  /** A 档里点「生成」：phase-1 立刻登记任务，然后等待可控的网络 deferred。 */
  async function startGeneration(repeatClick = false) {
    const pending = deferred<{ src: string; finalPrompt?: string; finalNegativePrompt?: string; promptCompacted?: boolean }>();
    outstanding = pending;
    generateImageMock.mockImplementation(() => pending.promise);
    const companion = selectByLabel('选择伙伴');
    await act(async () => {
      companion.value = 'npc_amber';
      companion.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    // 提示词编辑器默认折叠（`promptEditorOpen`），必须先打开才能拿到 rows=7 的正文提示词框。
    await act(async () => { exactButton('高级提示词编辑').click(); });
    const prompt = Array.from(document.querySelectorAll('textarea'))
      .find((candidate) => candidate.getAttribute('rows') === '7' && !candidate.hasAttribute('placeholder'));
    if (!(prompt instanceof HTMLTextAreaElement)) throw new Error('找不到提示词输入框');
    await act(async () => { setTextareaValue(prompt, '安柏的骑士团头像'); });
    await flush();
    await act(async () => {
      const generate = exactButton('生成', 'min-h-[54px]');
      generate.click();
      if (repeatClick) generate.click();
    });
    await flush();
    return pending;
  }

  it('phase-1：点击生成先把任务登记在当前档（修复前后的共同前置）', async () => {
    await mountPanel();
    await startGeneration();
    expect(sessions[1]!.album.current.tasks).toHaveLength(1);
    expect(sessions[1]!.album.current.tasks[0]?.targetId).toBe('npc_amber');
  });

  it('开发模式的重复挂载检查不会把后续英文准备永久取消', async () => {
    useStrictMode = true;
    await mountPanel();
    const image = await startGeneration();
    expect(generateImageMock).toHaveBeenCalledTimes(1);
    await act(async () => image.resolve({ src: 'data:image/png;base64,QU1CRVI=' }));
    await settle();
    expect(sessions[1]!.album.current.entries).toHaveLength(1);
  });

  it('图片接口未启用时不先调用英文翻译接口', async () => {
    imageApiEnabled = false;
    await mountPanel();
    await startGeneration();
    expect(chatCompletionNonStream).not.toHaveBeenCalled();
    expect(generateImageMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('接口未启用');
  });

  it('英文资料准备期间的重复点击只登记并调用一次图片请求', async () => {
    const translation = deferred<string>();
    vi.mocked(chatCompletionNonStream).mockImplementation(() => translation.promise);
    await mountPanel();
    const image = await startGeneration(true);
    await act(async () => { translation.resolve(JSON.stringify({ name: 'Amber', gender: 'female' })); });
    await settle(() => generateImageMock.mock.calls.length > 0);
    expect(sessions[1]!.album.current.tasks).toHaveLength(1);
    await act(async () => { image.resolve({ src: 'data:image/png;base64,QU1CRVI=' }); });
    await settle();
    expect(generateImageMock).toHaveBeenCalledTimes(1);
  });

  it('图片等待期间角色外貌变化，旧图片不会作为成功结果保存', async () => {
    await mountPanel();
    const image = await startGeneration();
    sessions[1]!.npcs.current = sessions[1]!.npcs.current.map(item => ({ ...item, 外貌: 'silver hair' }));
    await renderHost();
    await act(async () => { image.resolve({ src: 'data:image/png;base64,QU1CRVI=' }); });
    await settle();
    expect(sessions[1]!.album.current.entries).toHaveLength(0);
    expect(sessions[1]!.album.current.tasks[0]?.status).toBe('failed');
    expect(document.body.textContent).toContain('角色资料已变化');
  });

  it('最终提交检查活体资料，即使界面还没有收到新资料', async () => {
    await mountPanel();
    const image = await startGeneration();
    sessions[1]!.npcs.current = sessions[1]!.npcs.current.map(item => ({ ...item, 外貌: 'silver hair' }));
    // 不刷新宿主：面板props仍是旧值，提交必须读事务里现在的资料。
    await act(async () => { image.resolve({ src: 'data:image/png;base64,QU1CRVI=' }); });
    await settle();
    expect(sessions[1]!.album.current.entries).toHaveLength(0);
    expect(sessions[1]!.album.current.tasks[0]?.status).toBe('failed');
  });

  it('相册与成功任务保存供应商实际发送的精简提示词，仍保留原始来源', async () => {
    await mountPanel();
    const pending = await startGeneration();
    await act(async () => { pending.resolve({ src: 'data:image/png;base64,QU1CRVI=', finalPrompt: 'Amber, red ribbon', finalNegativePrompt: 'blurry', promptCompacted: true }); });
    await settle(() => sessions[1]!.album.current.tasks[0]?.status === 'success');
    const album = sessions[1]!.album.current;
    expect(album.assets.find(asset => asset.id === album.entries[0]?.assetId)).toMatchObject({ prompt: 'Amber, red ribbon', finalPrompt: 'Amber, red ribbon', finalNegativePrompt: 'blurry', sourcePrompt: '安柏的骑士团头像' });
    expect(album.tasks[0]).toMatchObject({ finalPrompt: 'Amber, red ribbon', finalNegativePrompt: 'blurry', status: 'success' });
    expect(document.body.textContent).toContain('实际提示词已保存在图片详情');
  });

  it('伙伴头像的生成提示词按钮在未启用转化器时也展示精简草稿', async () => {
    sessions[1]!.npcs.current[0]!.外貌 = 'brown hair, amber eyes';
    sessions[1]!.npcs.current[0]!.穿着 = 'red rabbit ribbon';
    await mountPanel();
    await act(async () => {
      const companion = selectByLabel('选择伙伴');
      companion.value = 'npc_amber';
      companion.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { exactButton('生成提示词').click(); });
    const prompt = Array.from(document.querySelectorAll('textarea')).find(candidate => candidate.rows === 7 && !candidate.placeholder)!;
    expect(prompt.value.length).toBeLessThanOrEqual(1800);
    for (const tag of ['Amber', 'brown hair', 'amber eyes', 'red rabbit ribbon']) expect(prompt.value).toContain(tag);
    expect(sessions[1]!.npcs.current[0]?.姓名).toBe('安柏');
    expect(sessions[1]!.npcs.current[0]?.图像档案?.englishFacts?.facts.name).toBe('Amber');
    expect(document.body.textContent).toContain('自动精简');
  });

  it('精简伙伴头像不重新启用已关闭的角色锚点', async () => {
    const npc = sessions[1]!.npcs.current[0]!;
    npc.外貌 = 'brown hair';
    npc.图像档案 = { 角色锚点: { 是否启用: false, 正面提示词: 'silver hair' } };
    await mountPanel();
    await act(async () => {
      const companion = selectByLabel('选择伙伴');
      companion.value = 'npc_amber';
      companion.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { exactButton('生成提示词').click(); });
    const prompt = Array.from(document.querySelectorAll('textarea')).find(candidate => candidate.rows === 7 && !candidate.placeholder)!;
    expect(prompt.value).toContain('brown hair');
    expect(prompt.value).not.toContain('silver hair');
  });

  it.each([
    ['璃月港无人街道', false],
    ['安柏站在蒙德城喷泉旁', true],
  ])('场景精简遵守出场人物和场景锚点开关：%s', async (source, visible) => {
    const npc = sessions[1]!.npcs.current[0]!;
    npc.同行 = true;
    npc.外貌 = 'brown hair';
    if (!visible) sessions[1]!.traveler.current.图像档案 = { 角色锚点: { 是否启用: true, 正面提示词: 'purple player hair' } };
    if (visible) npc.图像档案 = { 角色锚点: { 是否启用: true, 场景生图自动注入: false, 正面提示词: 'silver hair' } };
    await mountPanel();
    const tab = Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent?.includes('场景图'))!;
    await act(async () => { tab.click(); });
    const input = Array.from(document.querySelectorAll('textarea')).find(candidate => candidate.placeholder.includes('写清地点、天气'))!;
    await act(async () => { setTextareaValue(input, source); });
    await act(async () => { exactButton('解析场景提示词').click(); });
    const prompt = Array.from(document.querySelectorAll('textarea')).find(candidate => candidate.rows === 7 && !candidate.placeholder)!;
    expect(prompt.value).not.toContain('silver hair');
    if (!visible) expect(prompt.value).not.toContain('purple player hair');
    if (visible) expect(prompt.value).toContain('brown hair');
    else expect(prompt.value).not.toContain('character 安柏');
  });

  it.each([
    ['场景图', '解析场景提示词', '写清地点、天气'],
    ['故事快照', '生成快照提示词', '粘贴或选择'],
  ])('%s 模型不可用时，生成按钮仍展示精简草稿', async (tab, buttonLabel, placeholder) => {
    await mountPanel();
    const tabButton = Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent?.includes(tab));
    if (!tabButton) throw new Error(`找不到 ${tab}`);
    await act(async () => { tabButton.click(); });
    const input = Array.from(document.querySelectorAll('textarea')).find(candidate => candidate.placeholder.includes(placeholder));
    if (!input) throw new Error('找不到场景输入框');
    await act(async () => { setTextareaValue(input, '安柏站在蒙德城喷泉旁，夕阳照亮红色兔耳发带。'); });
    await act(async () => { exactButton(buttonLabel).click(); });
    if (!Array.from(document.querySelectorAll('textarea')).some(candidate => candidate.rows === 7 && !candidate.placeholder)) {
      await act(async () => { exactButton('高级提示词编辑').click(); });
    }
    const prompt = Array.from(document.querySelectorAll('textarea')).find(candidate => candidate.rows === 7 && !candidate.placeholder)!;
    expect(prompt.value.length).toBeLessThanOrEqual(1800);
    expect(prompt.value).toContain('蒙德');
    expect(document.body.textContent).toContain('自动精简');
  });

  it('场景图模型成功后，精简草稿同时保留模型结果、启用锚点和质量增强', async () => {
    usePromptModel = true;
    useQualityPreset = true;
    sessions[1]!.npcs.current[0]!.图像档案 = { 角色锚点: { 是否启用: true, 正面提示词: 'silver hair, green ribbon', 负面提示词: 'red ribbon' } };
    const sceneResponse = JSON.stringify({
      scene: { title: '喷泉灯火', location: '蒙德喷泉', atmosphere: '灯火', subject: '安柏在喷泉旁挥手', camera: '中景', avoid: '' },
      prompt: 'Mondstadt fountain, evening lanterns, waving, cinematic framing', negativePrompt: 'fog',
    });
    vi.mocked(chatCompletionNonStream).mockImplementation(async (_config, request) => request.systemPrompt?.startsWith('Translate only') ? JSON.stringify({ name: 'Amber', gender: 'female' }) : sceneResponse);
    await mountPanel();
    const tab = Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent?.includes('场景图'))!;
    await act(async () => { tab.click(); });
    const input = Array.from(document.querySelectorAll('textarea')).find(candidate => candidate.placeholder.includes('写清地点、天气'))!;
    await act(async () => { setTextareaValue(input, '安柏站在喷泉旁。'); });
    await act(async () => { exactButton('解析场景提示词').click(); });
    await act(async () => { exactButton('高级提示词编辑').click(); });
    const prompt = Array.from(document.querySelectorAll('textarea')).find(candidate => candidate.rows === 7 && !candidate.placeholder)!;
    const negative = Array.from(document.querySelectorAll('textarea')).find(candidate => candidate.rows === 3 && !candidate.placeholder)!;
    for (const fact of ['evening lanterns', 'silver hair', 'green ribbon', 'fine watercolor paper grain']) expect(prompt.value).toContain(fact);
    for (const fact of ['fog', 'red ribbon', 'weak lighting']) expect(negative.value).toContain(fact);
    expect(prompt.value).not.toMatch(/APPEARANCE LOCK|higher priority|unless the user/i);
    expect(prompt.value.length).toBeLessThanOrEqual(1800);
    expect(chatCompletionNonStream).toHaveBeenCalledTimes(2);
  });

  it('A 档启动生图后切到 B 档：完成结果不进入 B 档', async () => {
    await mountPanel();
    const pending = await startGeneration();
    await switchToSession(2);

    await act(async () => { pending.resolve({ src: 'data:image/png;base64,QU1CRVI=' }); });
    await settle();

    const albumB = sessions[2]!.album.current;
    expect(albumB.entries).toHaveLength(0);
    expect(albumB.assets).toHaveLength(0);
    expect(albumB.tasks).toHaveLength(0);
  });

  it('同一 session 内照常写回（守卫不能把正常路径也挡掉）', async () => {
    await mountPanel();
    const pending = await startGeneration();

    await act(async () => { pending.resolve({ src: 'data:image/png;base64,QU1CRVI=' }); });
    await settle(() => sessions[1]!.album.current.tasks[0]?.status === 'success');

    const albumA = sessions[1]!.album.current;
    expect(albumA.tasks).toHaveLength(1);
    expect(albumA.tasks[0]?.status).toBe('success');
    expect(albumA.entries).toHaveLength(1);
    expect(albumA.assets).toHaveLength(1);
  });

  it('面板保持打开切换存档后，新档仍可正常登记和完成生图', async () => {
    await mountPanel();
    await switchToSession(2);
    const pending = await startGeneration();
    expect(sessions[2]!.album.current.tasks).toHaveLength(1);
    await act(async () => { pending.resolve({ src: 'data:image/png;base64,Ql9JTUFHRQ==' }); });
    await settle(() => sessions[2]!.album.current.tasks[0]?.status === 'success');
    expect(sessions[2]!.album.current.entries).toHaveLength(1);
    expect(sessions[1]!.album.current.entries).toHaveLength(0);
  });

  it('切档后旧结果既不写新档，也不回到原档（不产生悬挂任务）', async () => {
    await mountPanel();
    const pending = await startGeneration();
    await switchToSession(2);

    await act(async () => { pending.resolve({ src: 'data:image/png;base64,QU1CRVI=' }); });
    await settle();

    expect(sessions[1]!.album.current.entries).toHaveLength(0);
    expect(sessions[1]!.album.current.tasks.every((task) => task.status !== 'success')).toBe(true);
    expect(sessions[2]!.album.current.entries).toHaveLength(0);
    expect(sessions[2]!.album.current.assets).toHaveLength(0);
  });

  it('结果迟到跨越整档重开（另一个会话已读档）同样不写新档', async () => {
    await mountPanel();
    const pending = await startGeneration();
    await switchToSession(2);
    // 模拟「读档 / 新开局」：B 档已经有自己的相册内容。
    sessions[2]!.album.current = {
      ...创建空相册系统(),
      entries: [{
        id: 'album_b_own', assetId: 'asset_b_own', title: 'B 档自己的图', targetType: 'misc',
        slot: 'misc', tags: [], nsfw: false, createdAt: 5, referenceTargets: [],
      }],
    };
    await renderHost();

    await act(async () => { pending.resolve({ src: 'data:image/png;base64,QU1CRVI=' }); });
    await settle();

    expect(sessions[2]!.album.current.entries.map((entry) => entry.id)).toEqual(['album_b_own']);
    expect(sessions[2]!.album.current.tasks).toHaveLength(0);
  });

  it('异步旅行者锚点写回同样受 session 保护', async () => {
    await mountPanel();
    const pending = deferred<{ id: string; 名称: string }>();
    extractAnchorMock.mockImplementation(() => pending.promise);
    await openAnchorWorkspace();

    await act(async () => { exactButton('主控锚点提取').click(); });
    await switchToSession(2);

    await act(async () => { pending.resolve({ id: 'anchor_late', 名称: '迟到的锚点' }); });
    await settle();

    expect(sessions[2]!.traveler.current.图像档案?.角色锚点).toBeUndefined();
    expect(sessions[1]!.traveler.current.图像档案?.角色锚点).toBeUndefined();
  });

  it('同一 session 内异步旅行者锚点照常写回', async () => {
    await mountPanel();
    const pending = deferred<{ id: string; 名称: string }>();
    extractAnchorMock.mockImplementation(() => pending.promise);
    await openAnchorWorkspace();
    await act(async () => { exactButton('主控锚点提取').click(); });

    await act(async () => { pending.resolve({ id: 'anchor_now', 名称: '当场锚点' }); });
    await settle();

    expect(sessions[1]!.traveler.current.图像档案?.角色锚点?.名称).toBe('当场锚点');
  });
});




