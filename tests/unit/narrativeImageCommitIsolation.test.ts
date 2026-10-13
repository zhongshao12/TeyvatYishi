import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState, type TeyvatGameState } from '@/models/teyvat';
import { 创建空角色 } from '@/models/character';
import { 创建NPC记录 } from '@/models/npc';
import { 创建默认游戏设置 } from '@/models/settings';
import type { 叙事插图 } from '@/models/chat';
import { applyLegacyGameStateOverrides, createLegacyGameViewSelector, type UseGameStateReturn } from '@/hooks/useGameState';
import { generateNarrativeImagesForMessage, regenerateNarrativeImagesForMessage } from '@/hooks/useGame/narrativeImageWorkflow';
import { 创建相册图片条目, 添加图片到相册 } from '@/utils/albumActions';
import { clearAlbumAssetObjectUrlCache } from '@/utils/albumObjectUrl';
import { 创建空相册系统 } from '@/models/imageGeneration';
import { imageCharacterSourceKey } from '@/utils/imageCharacterFacts';
import type { StorySnapshotResolution } from '@/services/ai/storySnapshotPipeline';

const network = vi.hoisted(() => ({ image: vi.fn(), snapshot: vi.fn() }));
vi.mock('@/services/ai/imageGeneration', () => ({ generateNarrativeImage: (...args: unknown[]) => network.image(...args) }));
vi.mock('@/services/ai/storySnapshotPipeline', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/ai/storySnapshotPipeline')>(),
  resolveStorySnapshot: (...args: unknown[]) => network.snapshot(...args),
}));
const body = '阿林站在蒙德城门，向你挥手。';
const image: 叙事插图 = { id: 'new-image', dataUrl: 'https://example.invalid/generated.png', type: 'scene', kind: 'snapshot',
  prompt: 'Arin, brown hair, city gate', negativePrompt: 'blurry', description: '城门重逢', status: 'done' };
const snapshot: StorySnapshotResolution = {
  summary: { title: '城门重逢', characters: ['阿林'], location: '蒙德', atmosphere: '', action: '挥手', camera: '', avoid: '' },
  prompt: image.prompt, negativePrompt: 'blurry', sourcePrompt: body, sceneText: 'city gate', source: 'local',
  renderContext: { schemaVersion: 1, scenePrompt: 'city gate', sceneNegativePrompt: 'blurry',
    characters: [{ name: '阿林', subjectType: 'boy', source: 'npc', enabled: true, visualPrompt: 'Arin, brown hair', negativePrompt: '' }] },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function ownAlbum(title: string) {
  return 添加图片到相册(创建空相册系统(), 创建相册图片条目({ title, src: `https://example.invalid/${title}.png`, source: 'upload' }));
}
function harness() {
  const select = createLegacyGameViewSelector();
  let session = 1;
  let live = applyLegacyGameStateOverrides(createEmptyTeyvatGameState(), {
    旅人: { ...创建空角色(), 姓名: '云' },
    NPC: [
      { ...创建NPC记录({ 姓名: '阿林', 初见回合: 1 }), id: 'npc-a', 性别: '男', 外貌: 'brown hair' },
      { ...创建NPC记录({ 姓名: '阿洛', 初见回合: 1 }), id: 'npc-b', 性别: '男', 外貌: 'blue hair' },
    ],
    相册: ownAlbum('old'),
    chatHistory: [{ id: 'assistant-1', role: 'assistant', content: body, timestamp: 1, gameTime: '1',
      narrativeImages: [{ ...image, id: 'old-image' }] }],
  });
  const initial = live;
  const state = {
    ...select(live), game: live, gameSettings: 创建默认游戏设置(), turnCount: 1,
    getGameSessionId: () => session,
    updateGameState: (update: (value: TeyvatGameState) => TeyvatGameState) => { live = update(live); },
    set相册: (action: UseGameStateReturn['相册'] | ((previous: UseGameStateReturn['相册']) => UseGameStateReturn['相册'])) => {
      live = applyLegacyGameStateOverrides(live, { 相册: typeof action === 'function' ? action(select(live).相册) : action });
    },
    setChatHistory: (action: UseGameStateReturn['chatHistory'] | ((previous: UseGameStateReturn['chatHistory']) => UseGameStateReturn['chatHistory'])) => {
      live = applyLegacyGameStateOverrides(live, { chatHistory: typeof action === 'function' ? action(select(live).chatHistory) : action });
    },
    setQueueTasks: (action: (previous: UseGameStateReturn['queueTasks']) => UseGameStateReturn['queueTasks']) => {
      live = applyLegacyGameStateOverrides(live, { queueTasks: action(select(live).queueTasks) });
    },
  } as unknown as UseGameStateReturn;
  state.gameSettings.文生图系统.普通接口.enabled = true;
  state.gameSettings.文生图系统.正文生图.enabled = true;
  state.gameSettings.文生图系统.正文生图.playerAppearanceMode = 'off';
  return {
    state, initial, view: () => select(live), root: () => live,
    switchSave: (next: TeyvatGameState) => { session++; live = next; },
    edit: (overrides: Parameters<typeof applyLegacyGameStateOverrides>[1]) => { live = applyLegacyGameStateOverrides(live, overrides); },
    params: { state, body, messageId: 'assistant-1', tokenizerConfig: null,
      imageApiConfig: state.gameSettings.文生图系统.普通接口, turn: 1, replaceExisting: true },
  };
}
async function waitForImage() { await vi.waitFor(() => expect(network.image).toHaveBeenCalledOnce()); }

describe('narrative image root commit isolation (A01)', () => {
  beforeEach(() => {
    network.snapshot.mockReset().mockResolvedValue(snapshot);
    network.image.mockReset();
  });
  afterEach(() => clearAlbumAssetObjectUrlCache());

  it.each(['done', 'failed', 'throw'] as const)('does not write a late %s result, chat update, or queue record into another save', async outcome => {
    const h = harness();
    const result = deferred<叙事插图>();
    network.image.mockReturnValue(result.promise);
    const pending = generateNarrativeImagesForMessage(h.params);
    await waitForImage();
    const other = applyLegacyGameStateOverrides(createEmptyTeyvatGameState(), { 相册: ownAlbum('other'), chatHistory: h.view().chatHistory });
    h.switchSave(other);
    if (outcome === 'throw') result.reject(new Error('fixture image failure'));
    else result.resolve({ ...image, status: outcome, ...(outcome === 'failed' ? { error: 'fixture failed' } : {}) });
    expect(await pending).toBeNull();
    expect(h.root()).toBe(other);
  });

  it('merges generated images with concurrent additions without resurrecting deletions', async () => {
    const h = harness();
    const result = deferred<叙事插图>(); network.image.mockReturnValue(result.promise);
    const pending = generateNarrativeImagesForMessage(h.params);
    await waitForImage();
    h.edit({ 相册: ownAlbum('new-user-image') }); // old entry was deleted while generation waited
    result.resolve(image);
    expect(await pending).toHaveLength(1);
    expect(h.view().相册.entries.map(entry => entry.title).sort()).toEqual(['new-user-image', '城门重逢']);
    expect(h.view().chatHistory[0]?.narrativeImages?.map(item => item.id)).toEqual(['new-image']);
  });

  it.each(['body', 'appearance', 'prepared-anchor'] as const)('rejects a stale %s without overwriting its current state', async field => {
    const h = harness();
    const result = deferred<叙事插图>(); network.image.mockReturnValue(result.promise);
    const pending = generateNarrativeImagesForMessage(h.params);
    await waitForImage();
    if (field === 'body') h.edit({ chatHistory: h.view().chatHistory.map(message => ({ ...message, content: '玩家编辑后的另一段正文' })) });
    else h.edit({ NPC: h.view().NPC.map(npc => npc.id !== 'npc-a' ? npc : field === 'appearance'
      ? { ...npc, 外貌: 'silver hair' }
      : { ...npc, 图像档案: { ...npc.图像档案, englishFacts: {
        schemaVersion: 1, sourceKey: imageCharacterSourceKey(npc), preparedAt: 1,
        facts: { language: 'en', name: 'Arin', gender: 'male', appearance: 'brown hair' },
        anchorSourceKey: JSON.stringify({ prompt: 'red hair', negative: '' }), anchorPrompt: 'red hair', anchorNegative: '',
      } } }) });
    if (field === 'prepared-anchor') expect(h.view().NPC.find(npc => npc.id === 'npc-a')?.图像档案?.englishFacts?.anchorPrompt).toBe('red hair');
    const album = h.root().相册;
    result.resolve(image);
    expect(await pending).toBeNull();
    expect(h.root().相册).toBe(album);
    expect(h.view().chatHistory[0]?.narrativeImages?.[0]?.id).toBe('old-image');
  });

  it('does not reject the result when only a character outside the snapshot changes', async () => {
    const h = harness();
    const result = deferred<叙事插图>(); network.image.mockReturnValue(result.promise);
    const pending = generateNarrativeImagesForMessage(h.params);
    await waitForImage();
    h.edit({ NPC: h.view().NPC.map(npc => npc.id === 'npc-b' ? { ...npc, 外貌: 'silver hair' } : npc) });
    result.resolve(image);
    expect(await pending).toHaveLength(1);
    expect(h.view().NPC.find(npc => npc.id === 'npc-b')?.外貌).toBe('silver hair');
  });

  it('does not call the image provider after source text changes during prompt parsing', async () => {
    const h = harness();
    const parsed = deferred<StorySnapshotResolution>(); network.snapshot.mockReturnValue(parsed.promise);
    const pending = generateNarrativeImagesForMessage(h.params);
    await vi.waitFor(() => expect(network.snapshot).toHaveBeenCalledOnce());
    h.edit({ chatHistory: h.view().chatHistory.map(message => ({ ...message, content: '新正文' })) });
    network.image.mockResolvedValue(image);
    parsed.resolve(snapshot);
    expect(await pending).toBeNull();
    expect(network.image).not.toHaveBeenCalled();
  });

  it.each(['before', 'waiting'] as const)('does not commit a cancelled request (%s)', async phase => {
    const h = harness();
    const controller = new AbortController();
    const result = deferred<叙事插图>(); network.image.mockReturnValue(result.promise);
    if (phase === 'before') controller.abort();
    const pending = generateNarrativeImagesForMessage({ ...h.params, signal: controller.signal });
    if (phase === 'waiting') { await waitForImage(); controller.abort(); }
    result.resolve(image);
    expect(await pending).toBeNull();
    expect(h.view().相册.entries.map(entry => entry.title)).toEqual(['old']);
    expect(h.view().chatHistory[0]?.narrativeImages?.[0]?.id).toBe('old-image');
    if (phase === 'before') expect(network.image).not.toHaveBeenCalled();
  });

  it('replaces the selected message images on a normal manual regeneration', async () => {
    const h = harness(); network.image.mockResolvedValue(image);
    await regenerateNarrativeImagesForMessage(h.state, () => null, 'assistant-1');
    const stored = h.view().chatHistory[0]?.narrativeImages;
    expect(stored).toHaveLength(1);
    expect(stored?.[0]).toMatchObject({ id: 'new-image', status: 'done' });
    expect(stored?.[0]?.dataUrl).toMatch(/^asset:/);
    expect(h.view().相册.entries.some(entry => entry.assetId === stored?.[0]?.assetId)).toBe(true);
  });

  it.each(['body', 'appearance'] as const)('cleans up only its own manual placeholder after %s invalidates generation', async field => {
    const h = harness();
    const result = deferred<叙事插图>(); network.image.mockReturnValue(result.promise);
    const pending = regenerateNarrativeImagesForMessage(h.state, () => null, 'assistant-1');
    await waitForImage();
    expect(h.view().chatHistory[0]?.narrativeImages?.[0]?.status).toBe('generating');
    if (field === 'body') h.edit({ chatHistory: h.view().chatHistory.map(message => ({ ...message, content: '当前编辑后的正文' })) });
    else h.edit({ NPC: h.view().NPC.map(npc => npc.id === 'npc-a' ? { ...npc, 外貌: 'silver hair' } : npc) });
    result.resolve(image);
    await pending;
    expect(h.view().chatHistory[0]?.narrativeImages?.[0]).toMatchObject({ id: 'old-image', status: 'done' });
    expect(h.view().相册.entries.map(entry => entry.title)).toEqual(['old']);
    if (field === 'body') expect(h.view().chatHistory[0]?.content).toBe('当前编辑后的正文');
    else expect(h.view().NPC.find(npc => npc.id === 'npc-a')?.外貌).toBe('silver hair');
  });

  it('does not overwrite a newer completed manual regeneration with an older late result', async () => {
    const h = harness();
    const first = deferred<叙事插图>();
    const second = deferred<叙事插图>();
    network.image.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const oldRequest = regenerateNarrativeImagesForMessage(h.state, () => null, 'assistant-1');
    await waitForImage();
    const newRequest = regenerateNarrativeImagesForMessage(h.state, () => null, 'assistant-1');
    await vi.waitFor(() => expect(network.image).toHaveBeenCalledTimes(2));
    second.resolve({ ...image, id: 'newer-image' });
    await newRequest;
    first.resolve(image);
    await oldRequest;
    expect(h.view().chatHistory[0]?.narrativeImages?.map(item => item.id)).toEqual(['newer-image']);
    expect(h.view().相册.entries).toHaveLength(2);
  });

  it('does not clear a later manual placeholder when the older request fails', async () => {
    const h = harness();
    const first = deferred<叙事插图>();
    const second = deferred<叙事插图>();
    network.image.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const oldRequest = regenerateNarrativeImagesForMessage(h.state, () => null, 'assistant-1');
    await waitForImage();
    const newRequest = regenerateNarrativeImagesForMessage(h.state, () => null, 'assistant-1');
    await vi.waitFor(() => expect(network.image).toHaveBeenCalledTimes(2));
    const newerPlaceholders = h.view().chatHistory[0]?.narrativeImages;
    first.reject(new Error('older request failed'));
    await oldRequest;
    expect(h.view().chatHistory[0]?.narrativeImages).toEqual(newerPlaceholders);
    expect(h.view().chatHistory[0]?.narrativeImages?.every(item => item.status === 'generating')).toBe(true);
    second.resolve({ ...image, id: 'newer-image' });
    await newRequest;
    expect(h.view().chatHistory[0]?.narrativeImages?.[0]).toMatchObject({ id: 'newer-image', status: 'done' });
  });

  it('does not restore manual placeholders into a different save', async () => {
    const h = harness();
    const result = deferred<叙事插图>(); network.image.mockReturnValue(result.promise);
    const pending = regenerateNarrativeImagesForMessage(h.state, () => null, 'assistant-1');
    await waitForImage();
    const other = createEmptyTeyvatGameState();
    h.switchSave(other);
    result.resolve(image);
    await pending;
    expect(h.root()).toBe(other);
  });

  it('keeps recovery generation local until its owning recovery workflow commits', async () => {
    const h = harness(); network.image.mockResolvedValue(image);
    const before = h.root().相册;
    let localAlbum = ownAlbum('recovery-local');
    const generated = await generateNarrativeImagesForMessage({ ...h.params, writeDomainState: false,
      domainContext: { 旅人: h.state.旅人, NPC: h.state.NPC, 相册: localAlbum, onAlbumChange: next => { localAlbum = next; } } });
    expect(generated).toHaveLength(1);
    expect(h.root().相册).toEqual(before);
    expect(localAlbum.entries.map(entry => entry.title).sort()).toEqual(['recovery-local', '城门重逢']);
  });
});
