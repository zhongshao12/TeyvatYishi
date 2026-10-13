// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { 创建空角色 } from '@/models/character';
import { 创建NPC记录 } from '@/models/npc';
import { 创建空相册系统 } from '@/models/imageGeneration';
import { 创建默认游戏设置, type API设置 } from '@/models/settings';
import { createEmptyCourierSystem } from '@/models/teyvat/courier';
import { createEmptyTeyvatGameState, type TeyvatGameState } from '@/models/teyvat/state';
import { resolveCourierPhotoTarget } from '@/services/courierPhoto';
import { CourierPhotoComposer } from '@/components/features/Courier/CourierPhotoComposer';
import { AlbumPanel } from '@/components/features/GameSystems/AlbumPanel';
import { compileNovelAIPrompt } from '@/services/ai/novelaiPromptCompiler';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const imageApi = vi.hoisted(() => vi.fn());
vi.mock('@/services/ai/imageGeneration', async original => ({ ...await original<typeof import('@/services/ai/imageGeneration')>(), generateImage: imageApi }));
vi.mock('@/services/storage/indexedSettingsStore', async original => ({ ...await original<typeof import('@/services/storage/indexedSettingsStore')>(), loadSetting: async () => null, saveSetting: async () => undefined }));
vi.mock('@/services/ai/chatCompletionClient', async original => ({ ...await original<object>(), chatCompletionNonStream: vi.fn(async (_config, request) => {
  const source = JSON.parse(String(request.messages[0].content));
  return JSON.stringify({ ...source, name: source.name === '云' ? 'Yun' : 'Amber', gender: source.gender === '女' ? 'female' : source.gender === '男' ? 'male' : source.gender });
}) }));
const apiSettings: API设置 = { activeConfigId: 'text', configs: [{ id: 'text', name: 'test-only', provider: 'openai', baseUrl: 'https://unused.invalid', apiKey: 'unused', model: 'mock-text', retryCount: 0, createdAt: 1, updatedAt: 1 }] };
let root: Root | undefined;
let host: HTMLDivElement;
const npc = { ...创建NPC记录({ 姓名: '安柏', 初见回合: 1 }), id: 'amber', 性别: '女' as const, 阶位: 'companion' as const, 外貌: 'brown hair, green eyes', 同行: true };
const traveler = { ...创建空角色(), id: 'traveler', 姓名: '云', 性别: '男' as const, 外貌: 'black hair' };
const button = (label: string) => Array.from(document.querySelectorAll('button')).reverse().find(item => item.textContent?.trim() === label)!;
function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
function settings(backend: 'latent' | 'novelai' = 'latent') {
  const game = 创建默认游戏设置();
  game.文生图系统.enabled = true; game.文生图系统.enablePromptTokenizer = false;
  game.文生图系统.普通接口 = { ...game.文生图系统.普通接口, backend, enabled: true, baseUrl: 'https://example.invalid', apiKey: 'test-only', model: backend === 'novelai' ? 'nai-diffusion-4-full' : 'test', retryCount: 0 };
  return game;
}
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); imageApi.mockReset().mockResolvedValue({ src: 'https://example.invalid/prompt-library.webp' }); });
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; host.remove(); });
async function chooseQuality() {
  expect(document.querySelector('[aria-label="生图提示词库"]'), 'photo and album must expose the shared picker').not.toBeNull();
  await act(async () => input(document.querySelector<HTMLInputElement>('[aria-label="搜索提示词"]')!, '清晰高质量'));
  await act(async () => button('追加两者').click());
  expect(imageApi).not.toHaveBeenCalled();
}
async function album(backend: 'latent' | 'novelai' = 'latent') {
  let current = 创建空相册系统(); const game = settings(backend);
  await act(async () => root!.render(createElement(AlbumPanel, {
    album: current, onAlbumChange: update => { current = typeof update === 'function' ? update(current) : update; },
    traveler, onTravelerChange: () => undefined, npcs: [npc], onNpcChange: () => undefined,
    gameSettings: game, imageSettings: game.文生图系统, onGameSettingsChange: () => undefined,
    apiSettings, nsfwEnabled: false, nsfwImageEnabled: false, mainChatHistory: [], getGameSessionId: () => 1,
  })));
}
describe('prompt library real generation entrypoints', () => {
  it('appends phone snippets without API cost, then confirms character and request facts within Latent limits', async () => {
    const courier = { ...createEmptyCourierSystem(), contacts: [{ id: 'contact', npcId: 'amber', name: '安柏', available: true }],
      conversations: [{ id: 'chat', title: '安柏', type: 'private' as const, participantIds: ['player', 'contact'], unread: 0, typingMemberIds: [], updatedAt: 1, messages: [
        { id: 'ask', senderId: 'player', senderName: '云', role: 'user' as const, content: '拍张城门的照片', turn: 2, timestamp: 1, readBy: [] },
        { id: 'reply', senderId: 'contact', senderName: '安柏', role: 'contact' as const, content: '好呀', turn: 2, timestamp: 2, readBy: [] },
      ] }] };
    const target = resolveCourierPhotoTarget(courier, [npc], 'chat', 'reply')!.target;
    let state: TeyvatGameState = { ...createEmptyTeyvatGameState(), 手机: courier };
    await act(async () => root!.render(createElement(CourierPhotoComposer, { target, courier, npcRecords: [npc], album: 创建空相册系统(),
      imageSettings: settings().文生图系统, apiSettings, getGameSessionId: () => 1, onAlbumChange: () => undefined,
      onCommitPhoto: update => { state = update(state); return true; }, onClose: () => undefined })));
    const original = document.querySelector<HTMLTextAreaElement>('[aria-label="照片正面提示词"]')!.value;
    await chooseQuality();
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="照片正面提示词"]')!.value).toContain(original);
    await act(async () => button('确认生成').click());
    const request = imageApi.mock.calls[0]?.[1];
    expect(request.prompt).toMatch(/Amber/); expect(request.prompt).toMatch(/城门/); expect(request.prompt).toMatch(/brown hair/);
    expect(request.prompt).toContain('best quality'); expect(request.negativePrompt).toContain('jpeg artifacts');
    expect(request.prompt.length).toBeLessThanOrEqual(2000); expect(request.negativePrompt.length).toBeLessThanOrEqual(2000);
  });
  it('uses selected snippets in the real album portrait request without erasing the named companion', async () => {
    await album();
    const select = Array.from(document.querySelectorAll('label')).find(item => item.textContent?.includes('选择伙伴'))!.querySelector('select')!;
    await act(async () => { select.value = 'amber'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => button('生成提示词').click());
    await chooseQuality();
    await act(async () => button('生成').click());
    expect(imageApi.mock.calls.length, document.body.textContent ?? '').toBe(1);
    const request = imageApi.mock.calls[0]?.[1];
    expect(request.prompt).toContain('Amber'); expect(request.prompt).toContain('brown hair');
    expect(request.prompt).toContain('best quality'); expect(request.negativePrompt).toContain('jpeg artifacts');
  });
  it('updates the snapshot layered payload rather than an ignored flat prompt', async () => {
    await album('novelai');
    const tab = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes('故事快照'))!;
    await act(async () => tab.click());
    const source = Array.from(document.querySelectorAll('textarea')).find(item => item.placeholder.includes('粘贴或选择'))!;
    await act(async () => input(source, '安柏站在蒙德城门旁，晚霞照亮城墙。'));
    await act(async () => button('生成快照提示词').click());
    await chooseQuality();
    await act(async () => button('普通生成').click());
    expect(imageApi).toHaveBeenCalledTimes(1);
    const request = imageApi.mock.calls[0]?.[1];
    expect(request.storySnapshotContext?.scenePrompt).toContain('best quality');
    expect(request.storySnapshotContext?.sceneNegativePrompt).toContain('jpeg artifacts');
    expect(request.storySnapshotContext?.characters.some((character: { name: string }) => character.name === '安柏')).toBe(true);
    const compiled = compileNovelAIPrompt({ model: 'nai-diffusion-4-full', prompt: request.prompt, negativePrompt: request.negativePrompt, storySnapshotContext: request.storySnapshotContext });
    expect(compiled.basePrompt).toContain('sharp focus'); expect(compiled.baseNegativePrompt).toContain('jpeg artifacts');
  });
});
