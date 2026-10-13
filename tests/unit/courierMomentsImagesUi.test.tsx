// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { act, createElement, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CourierModal } from '@/components/features/Courier/CourierModal';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { normalizeJourneyAlbum } from '@/models/teyvat/runtimeSlices';
import { 创建默认游戏设置 } from '@/models/settings';
import { 归一化相册系统, type 相册条目 } from '@/models/imageGeneration';
import { 创建NPC记录, type NPC记录 } from '@/models/npc';
import { 创建空角色, type 角色数据结构 } from '@/models/character';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { 创建相册图片条目 } from '@/utils/albumActions';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const imageApi = vi.hoisted(() => vi.fn());
const textApi = vi.hoisted(() => vi.fn());
vi.mock('@/services/ai/imageGeneration', () => ({ generateImage: imageApi }));
vi.mock('@/services/ai/chatCompletionClient', () => ({ chatCompletionNonStream: textApi }));
let host: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; host.remove(); imageApi.mockReset(); textApi.mockReset(); vi.unstubAllGlobals(); });

function button(label: string) {
  const result = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label || item.getAttribute('aria-label') === label);
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
function typeInto(label: string, value: string) {
  const textarea = document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}
async function mount(withImage = true, npcRecords: NPC记录[] = [], traveler?: 角色数据结构) {
  let game = createEmptyTeyvatGameState(); let session = 1; let rerender!: () => void;
  game.NPC = npcRecords.flatMap(npc => normalizeTeyvatNpcRecords([{ id: npc.id, 姓名: npc.姓名 }]).map(record => ({
    ...record, 姓名: npc.姓名, gender: npc.性别 ?? '', appearance: npc.外貌 ?? '', appearanceFacts: npc.外貌档案,
  })));
  if (traveler) game.旅行者 = { ...game.旅行者, id: traveler.id, 姓名: traveler.姓名, 性别: traveler.性别, 外貌: traveler.外貌, 身高: traveler.身高 };
  if (withImage) {
    const image = 创建相册图片条目({ title: '湖边', src: 'https://example.invalid/lake.webp', source: 'upload' });
    game.相册 = normalizeJourneyAlbum({ assets: [image.asset], entries: [image.entry] });
  }
  const settings = 创建默认游戏设置().文生图系统;
  settings.enabled = true;
  settings.普通接口 = { ...settings.普通接口, enabled: true, baseUrl: 'https://example.invalid', apiKey: 'unused', model: 'test', retryCount: 0 };
  const requestComments = vi.fn();
  let rejectCommit = false; let commitCount = 0; let beforeCommit: (() => void) | undefined;
  const readAlbum = () => 归一化相册系统({ assets: game.相册.assets, tasks: game.相册.generationTasks,
    entries: game.相册.entries.flatMap<相册条目>(entry => entry.assetId ? [{ ...entry, assetId: entry.assetId,
      title: entry.title ?? entry.description, targetType: entry.targetType ?? 'misc', slot: entry.slot ?? 'misc',
      tags: entry.tags ?? [], nsfw: entry.nsfw === true, referenceTargets: entry.referenceTargets ?? [] }] : []),
  });
  function Harness() {
    const [, render] = useReducer(value => value + 1, 0); rerender = render;
    return createElement(CourierModal, {
      courier: game.手机, album: readAlbum(),
      imageSettings: settings, getGameSessionId: () => session,
      npcRecords, traveler, apiSettings: { activeConfigId: 'main', configs: [{ id: 'main', name: 'main', provider: 'openai_compatible', baseUrl: 'https://example.invalid', apiKey: 'unused', model: 'test', createdAt: 1, updatedAt: 1 }] },
      onCourierChange: update => { game = { ...game, 手机: typeof update === 'function' ? update(game.手机) : update }; render(); },
      onAlbumChange: update => {
        const previous = readAlbum();
        const next = typeof update === 'function' ? update(previous) : update;
        game = { ...game, 相册: normalizeJourneyAlbum({ ...game.相册, assets: next.assets, entries: next.entries, generationTasks: next.tasks }) }; render();
      },
      onCommitPhoto: (update, expected) => {
        if (rejectCommit || expected !== session) return false;
        beforeCommit?.(); beforeCommit = undefined;
        const next = update(game); const accepted = next !== game; game = next; if (accepted) commitCount++; render(); return accepted;
      },
      onRequestMomentComments: requestComments, onClose: vi.fn(),
    });
  }
  await act(async () => root!.render(createElement(Harness)));
  await act(async () => button('朋友圈').click());
  await act(async () => button('写下旅途此刻').click());
  await act(async () => { await vi.dynamicImportSettled(); });
  return { game: () => game, commits: () => commitCount, switchSession: () => { session++; rerender(); }, rejectCommit: () => { rejectCommit = true; }, requestComments,
    disableGeneration: () => { settings.enabled = false; rerender(); },
    changeNpcAppearance: () => { if (npcRecords[0]) npcRecords[0] = { ...npcRecords[0], 姓名: '更新后的名字', 外貌: 'blue hair' }; rerender(); },
    changeRootAtCommit: (kind: 'npc' | 'traveler', field: 'name' | 'appearance') => {
      beforeCommit = () => {
        // The root has already changed, but React has not rendered those changes into editor props.
        if (kind === 'npc') game = { ...game, NPC: game.NPC.map(npc => ({ ...npc,
          ...(field === 'name' ? { 姓名: 'New root subject' } : { appearance: 'blue hair' }) })) };
        else game = { ...game, 旅行者: { ...game.旅行者,
          ...(field === 'name' ? { 姓名: 'New root subject' } : { 外貌: 'blue hair' }) } };
      };
    },
    populateAlbum: (count: number) => {
      const images = Array.from({ length: count }, (_, i) => 创建相册图片条目({ title: `照片${i + 1}`, src: `https://example.invalid/${i}.webp`, source: 'upload' }));
      game = { ...game, 相册: normalizeJourneyAlbum({ assets: images.map(image => image.asset), entries: images.map(image => image.entry) }) }; rerender();
    },
    reviseExternally: () => { game = { ...game, 手机: { ...game.手机, moments: game.手机.moments?.map(post => ({ ...post, content: '较新的正文', revision: post.revision + 1 })) } }; rerender(); } };
}

it('closing pending image generation and reopening does not keep the retained publisher busy', async () => {
  await mount(false);
  let finish!: (value: { src: string }) => void;
  imageApi.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => button('生成配图').click());
  await act(async () => typeInto('朋友圈配图正面提示词', 'sunlit garden'));
  await act(async () => button('确认生成配图').click());
  await act(async () => { await vi.waitFor(() => expect(imageApi).toHaveBeenCalledTimes(1)); });
  expect(button('发布').disabled).toBe(true);
  await act(async () => button('取消').click());
  await act(async () => finish({ src: 'https://example.invalid/cancelled.webp' }));
  await act(async () => button('写下旅途此刻').click());
  await act(async () => { await vi.dynamicImportSettled(); typeInto('写朋友圈', '取消后仍能发表'); });
  expect(button('发布').disabled).toBe(false);
});

it('selects and previews album images before publishing an image-only post, then edits/removes refs only', async () => {
  const ui = await mount();
  await act(async () => button('从相册选择').click());
  await act(async () => button('选择湖边').click());
  expect(ui.game().手机.moments).toEqual([]);
  expect(document.querySelector('img[alt="朋友圈草稿配图 1"]')).not.toBeNull();
  await act(async () => button('发布').click());
  expect(ui.game().手机.moments?.[0]?.images).toHaveLength(1);
  expect(ui.game().手机.moments?.[0]?.content).toBe('');
  await act(async () => button('编辑').click());
  await act(async () => button('移除配图 1').click());
  await act(async () => typeInto('编辑朋友圈', '只留正文'));
  await act(async () => button('保存修改').click());
  expect(ui.game().手机.moments?.[0]?.images).toBeUndefined();
  await act(async () => button('删除').click());
  expect(ui.game().相册.assets).toHaveLength(1);
  expect(ui.game().相册.entries).toHaveLength(1);
});

it('shows upload failures even when the image generation interface is disabled', async () => {
  const ui = await mount(false);
  await act(async () => ui.disableGeneration());
  const file = new File(['image'], 'large.png', { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: 12 * 1024 * 1024 + 1 });
  const input = document.querySelector<HTMLInputElement>('[aria-label="上传朋友圈配图"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(document.body.textContent).toContain('上传失败');
  expect(document.body.textContent).toContain('12MB');
  expect(ui.game().相册.assets).toHaveLength(0);
});

it.each(['translation', 'image'] as const)('keeps the scene draft and rejects stale character facts changed during %s', async stage => {
  const npc = { ...创建NPC记录({ 姓名: stage === 'translation' ? '角色来源甲' : '角色来源乙', 初见回合: 1 }), id: 'subject', 性别: '女' as const, 外貌: 'red hair' };
  let finishText!: (value: string) => void;
  let finishImage!: (value: { src: string }) => void;
  const translated = JSON.stringify({ name: 'Subject', gender: 'female', appearance: 'red hair' });
  if (stage === 'translation') textApi.mockImplementationOnce(() => new Promise(resolve => { finishText = resolve; }));
  else textApi.mockResolvedValueOnce(translated);
  if (stage === 'translation') imageApi.mockResolvedValueOnce({ src: 'https://example.invalid/stale.webp' });
  else imageApi.mockImplementationOnce(() => new Promise(resolve => { finishImage = resolve; }));
  const ui = await mount(false, [npc]);
  await act(async () => button('生成配图').click());
  const select = document.querySelector<HTMLSelectElement>('[aria-label="朋友圈配图角色"]')!;
  await act(async () => { select.value = 'subject'; select.dispatchEvent(new Event('change', { bubbles: true })); typeInto('朋友圈配图正面提示词', 'sunset lake'); });
  await act(async () => {
    button('确认生成配图').click();
    await vi.waitFor(() => stage === 'translation' ? expect(textApi).toHaveBeenCalledTimes(1) : expect(imageApi).toHaveBeenCalledTimes(1));
  });
  await act(async () => ui.changeNpcAppearance());
  await act(async () => {
    if (stage === 'translation') finishText(translated);
    else finishImage({ src: 'https://example.invalid/stale.webp' });
    await vi.waitFor(() => expect(['success', 'failed']).toContain(ui.game().相册.generationTasks[0]?.status));
  });
  expect(ui.game().相册.assets).toHaveLength(0);
  expect(ui.game().手机.moments).toEqual([]);
  if (stage === 'translation') expect(imageApi).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="朋友圈配图正面提示词"]')?.value).toBe('sunset lake');
  expect(document.body.textContent).toContain('角色姓名或外貌已变化');
});

it.each([
  ['npc', 'name'], ['npc', 'appearance'], ['traveler', 'name'], ['traveler', 'appearance'],
] as const)('rejects an old %s image when root %s changes at commit before editor rerender', async (kind, field) => {
  const npc = { ...创建NPC记录({ 姓名: 'Root npc subject', 初见回合: 1 }), id: 'subject', 性别: '女' as const, 外貌: 'red hair' };
  const traveler = { ...创建空角色(), id: 'root-traveler', 姓名: 'Root traveler subject', 性别: 'female', 外貌: 'red hair', 身高: '170 cm' };
  let finishImage!: (value: { src: string }) => void;
  textApi.mockResolvedValue(JSON.stringify({ name: 'Root npc subject', gender: 'female', appearance: 'red hair' }));
  imageApi.mockImplementationOnce(() => new Promise(resolve => { finishImage = resolve; }));
  const ui = await mount(false, kind === 'npc' ? [npc] : [], kind === 'traveler' ? traveler : undefined);
  await act(async () => button('生成配图').click());
  const select = document.querySelector<HTMLSelectElement>('[aria-label="朋友圈配图角色"]')!;
  await act(async () => { select.value = kind === 'npc' ? 'subject' : 'traveler'; select.dispatchEvent(new Event('change', { bubbles: true })); typeInto('朋友圈配图正面提示词', 'sunset lake'); });
  await act(async () => { button('确认生成配图').click(); await vi.waitFor(() => expect(imageApi).toHaveBeenCalledTimes(1)); });
  ui.changeRootAtCommit(kind, field);
  await act(async () => {
    finishImage({ src: 'https://example.invalid/old-root.webp' });
    await vi.waitFor(() => expect(['success', 'failed']).toContain(ui.game().相册.generationTasks[0]?.status));
  });
  const liveName = kind === 'npc' ? ui.game().NPC[0]?.姓名 : ui.game().旅行者.姓名;
  const liveAppearance = kind === 'npc' ? ui.game().NPC[0]?.appearance : ui.game().旅行者.外貌;
  expect(field === 'name' ? liveName : liveAppearance).toBe(field === 'name' ? 'New root subject' : 'blue hair');
  expect(ui.commits()).toBe(0);
  expect(ui.game().相册.assets).toHaveLength(0);
  expect(ui.game().手机.moments).toEqual([]);
  expect(document.querySelector('img[alt="朋友圈草稿配图 1"]')).toBeNull();
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="朋友圈配图正面提示词"]')?.value).toBe('sunset lake');
  expect(document.body.textContent).toContain('结果未写入');
});

it.each(['npc', 'traveler'] as const)('accepts the %s image when current root public facts still match', async kind => {
  const npc = { ...创建NPC记录({ 姓名: 'Current root npc', 初见回合: 1 }), id: 'subject', 性别: '女' as const, 外貌: 'red hair',
    外貌档案: { 发色: { value: 'red', source: 'manual' as const } } };
  const traveler = { ...创建空角色(), id: 'root-traveler', 姓名: 'Current root traveler', 性别: 'female', 外貌: 'red hair', 身高: '170 cm' };
  textApi.mockResolvedValue(JSON.stringify({ name: npc.姓名, gender: 'female', appearance: 'red hair', appearanceDetails: { 发色: { value: 'red' } } }));
  imageApi.mockResolvedValueOnce({ src: 'https://example.invalid/current-root.webp' });
  const ui = await mount(false, kind === 'npc' ? [npc] : [], kind === 'traveler' ? traveler : undefined);
  await act(async () => button('生成配图').click());
  const select = document.querySelector<HTMLSelectElement>('[aria-label="朋友圈配图角色"]')!;
  await act(async () => { select.value = kind === 'npc' ? 'subject' : 'traveler'; select.dispatchEvent(new Event('change', { bubbles: true })); typeInto('朋友圈配图正面提示词', 'sunset lake'); });
  await act(async () => { button('确认生成配图').click(); await vi.waitFor(() => expect(ui.commits()).toBe(1)); });
  expect(ui.game().相册.assets).toHaveLength(1);
  expect(ui.game().手机.moments).toEqual([]);
  expect(document.querySelector('img[alt="朋友圈草稿配图 1"]')).not.toBeNull();
});

it('uploads into the album before publication and reuses identical bytes without duplicate draft images', async () => {
  class ImmediateReader {
    result = 'data:image/png;base64,aGVsbG8=';
    onload: (() => void) | null = null;
    readAsDataURL() { this.onload?.(); }
  }
  vi.stubGlobal('FileReader', ImmediateReader);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL() { return 'blob:moment-image'; }
    static override revokeObjectURL() {}
  });
  const ui = await mount(false);
  async function upload() {
    const previous = ui.commits();
    const input = document.querySelector<HTMLInputElement>('[aria-label="上传朋友圈配图"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['hello'], 'lake.png', { type: 'image/png' })] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await vi.waitFor(() => expect(ui.commits()).toBe(previous + 1));
    });
  }
  await upload();
  expect(ui.game().手机.moments).toEqual([]);
  expect(ui.game().相册.assets).toHaveLength(1);
  expect(ui.game().相册.assets[0]?.contentHash).toHaveLength(64);
  await upload();
  expect(ui.game().相册.assets).toHaveLength(1);
  expect(document.querySelectorAll('img[alt="朋友圈草稿配图 1"]')).toHaveLength(1);
  expect(imageApi).not.toHaveBeenCalled();
  await act(async () => button('发布').click());
  expect(ui.game().手机.moments?.[0]?.images).toHaveLength(1);
  expect(JSON.stringify(ui.game().手机)).not.toContain('data:image');
});

it('limits the composer to nine images without dropping any selected image', async () => {
  const ui = await mount(false);
  await act(async () => ui.populateAlbum(10));
  for (let i = 1; i <= 9; i++) {
    await act(async () => button('从相册选择').click());
    await act(async () => button(`选择照片${i}`).click());
  }
  expect(button('从相册选择').disabled).toBe(true);
  expect(button('生成配图').disabled).toBe(true);
  await act(async () => button('发布').click());
  expect(ui.game().手机.moments?.[0]?.images).toHaveLength(9);
  expect(ui.game().相册.assets).toHaveLength(10);
});

it('does not let an old editor overwrite a newer Moment revision', async () => {
  const ui = await mount(false);
  await act(async () => typeInto('写朋友圈', '旧正文'));
  await act(async () => button('发布').click());
  await act(async () => button('编辑').click());
  await act(async () => ui.reviseExternally());
  expect(button('保存修改').disabled).toBe(true);
  expect(ui.game().手机.moments?.[0]?.content).toBe('较新的正文');
});

it('prepares only selected public character facts on confirm and does not carry them into the next scene-only image', async () => {
  const npc = { ...创建NPC记录({ 姓名: '丽莎', 初见回合: 1 }), id: 'lisa', 性别: '女' as const, 外貌: '紫色长发', 穿着: '秘密服装', 备注: ['关系记忆SECRET'],
    外貌档案: { 发色: { value: '紫色', source: 'manual' as const } } };
  textApi.mockResolvedValue(JSON.stringify({ name: 'Lisa', gender: 'female', appearance: 'long purple hair', appearanceDetails: { 发色: { value: 'purple' } } }));
  imageApi.mockResolvedValueOnce({ src: 'https://example.invalid/lisa.webp' }).mockResolvedValueOnce({ src: 'https://example.invalid/scene.webp' });
  await mount(false, [npc]);
  await act(async () => button('生成配图').click());
  const select = document.querySelector<HTMLSelectElement>('[aria-label="朋友圈配图角色"]')!;
  await act(async () => { select.value = 'lisa'; select.dispatchEvent(new Event('change', { bubbles: true })); typeInto('朋友圈配图正面提示词', 'sunset lake'); });
  expect(textApi).not.toHaveBeenCalled();
  await act(async () => { button('确认生成配图').click(); await vi.waitFor(() => expect(imageApi).toHaveBeenCalledTimes(1)); });
  expect(JSON.stringify(textApi.mock.calls)).not.toMatch(/SECRET|秘密服装|私密档案/);
  expect(imageApi.mock.calls[0]?.[1].prompt).toContain('character name: Lisa');
  expect(imageApi.mock.calls[0]?.[1].prompt).toContain('hair color: purple');
  expect(imageApi.mock.calls[0]?.[1].prompt).not.toMatch(/丽莎|紫色|好感|关系|记忆|穿着/);
  await act(async () => button('生成配图').click());
  const scene = document.querySelector<HTMLSelectElement>('[aria-label="朋友圈配图角色"]')!;
  await act(async () => { scene.value = 'scene'; scene.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => { button('确认生成配图').click(); await vi.waitFor(() => expect(imageApi).toHaveBeenCalledTimes(2)); });
  expect(imageApi.mock.calls[1]?.[1].prompt).not.toContain('Lisa');
  expect(imageApi.mock.calls[1]?.[1].prompt).not.toContain('purple');
});

it('does not call the image API on open, typing or selecting a library preset; confirm creates only a draft', async () => {
  imageApi.mockResolvedValue({ src: 'https://example.invalid/generated.webp', backend: 'openai_compatible' });
  const ui = await mount(false);
  await act(async () => button('生成配图').click());
  await act(async () => typeInto('朋友圈配图正面提示词', 'lake sunset'));
  expect(imageApi).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('提示词库');
  await act(async () => button('追加正面').click());
  expect(imageApi).not.toHaveBeenCalled();
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="朋友圈配图正面提示词"]')?.value).toContain('anime illustration');
  await act(async () => button('确认生成配图').click());
  expect(imageApi).toHaveBeenCalledTimes(1);
  expect(ui.game().相册.assets).toHaveLength(1);
  expect(ui.game().相册.generationTasks[0]?.status).toBe('success');
  expect(ui.game().手机.moments).toEqual([]);
  expect(document.querySelector('img[alt="朋友圈草稿配图 1"]')).not.toBeNull();
  expect(ui.requestComments).not.toHaveBeenCalled();
});

it('allows cancelling an in-flight upload without committing its late file read', async () => {
  let finish!: () => void;
  class DelayedReader {
    result = 'data:image/png;base64,aGVsbG8=';
    onload: (() => void) | null = null;
    readAsDataURL() { finish = () => this.onload?.(); }
  }
  vi.stubGlobal('FileReader', DelayedReader);
  const ui = await mount(false);
  const input = document.querySelector<HTMLInputElement>('[aria-label="上传朋友圈配图"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['hello'], 'lake.png', { type: 'image/png' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => button('取消上传').click());
  await act(async () => finish());
  expect(ui.game().相册.assets).toHaveLength(0);
  expect(ui.game().手机.moments).toEqual([]);
  vi.unstubAllGlobals();
});

it.each(['cancel', 'unmount', 'session', 'switch'] as const)('does not attach a late API result after %s', async kind => {
  let finish!: (result: { src: string }) => void;
  imageApi.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const ui = await mount(false);
  await act(async () => button('生成配图').click());
  await act(async () => typeInto('朋友圈配图正面提示词', 'lake sunset'));
  await act(async () => button('确认生成配图').click());
  const signal = imageApi.mock.calls[0]?.[1].signal as AbortSignal;
  await act(async () => {
    if (kind === 'cancel') button('取消生成').click();
    if (kind === 'unmount') { root!.unmount(); root = undefined; }
    if (kind === 'session') ui.switchSession();
    if (kind === 'switch') button('消息').click();
  });
  expect(signal.aborted).toBe(true);
  await act(async () => finish({ src: 'https://example.invalid/late.webp' }));
  expect(ui.game().相册.assets).toHaveLength(0);
  expect(ui.game().手机.moments).toEqual([]);
});

it('shows rejected root commits as failures without adding a preview attachment', async () => {
  imageApi.mockResolvedValue({ src: 'https://example.invalid/generated.webp' });
  const ui = await mount(false); ui.rejectCommit();
  await act(async () => button('生成配图').click());
  await act(async () => typeInto('朋友圈配图正面提示词', 'lake sunset'));
  await act(async () => button('确认生成配图').click());
  expect(ui.game().相册.assets).toHaveLength(0);
  expect(document.querySelector('img[alt="朋友圈草稿配图 1"]')).toBeNull();
  expect(document.body.textContent).toContain('结果未写入');
});
