// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { Core2App } from '@/components/features/Core2/Core2App';
import { makeSeed } from './fixtures';
import { AMBER_IMAGE_FACTS, seedAmberImageFacts } from './imageEnglishFixture';
import { cloneInCurrentBinaryRealm } from './jsdomBinaryClone';
import { createImagePromptLibraryStore } from '@/utils/createImagePromptLibraryStore';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => vi.unstubAllGlobals());
it('previews editable prompts and only queues image generation after explicit confirmation', async () => {
  const nativeClone = structuredClone; vi.stubGlobal('structuredClone', <T,>(value: T) => cloneInCurrentBinaryRealm(value, nativeClone));
  vi.stubGlobal('URL', class extends URL { static override createObjectURL() { return 'blob:test-generated'; } static override revokeObjectURL() {} });
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-album-generate-' + crypto.randomUUID() }), seed = makeSeed(); seed.records = seed.records.filter(row => row.domain !== 'album');
  seedAmberImageFacts(seed);
  const generate = vi.fn(async () => ({ bytes: Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII='), c => c.charCodeAt(0)), mimeType: 'image/png' }));
  const prepare = async (_snapshot: unknown, input: { title: string; userInput: string }) => ({ request: { title: input.title, kind: 'character' as const, npcIds: ['npc-amber'], prompt: 'Amber, female, ' + input.userInput, negative: 'watermark', size: '512x512', characters: [AMBER_IMAGE_FACTS] } });
  const library = createImagePromptLibraryStore({ load: async () => ({ version: 1, items: [{ id: 'custom-fixture', name: '测试外景词组', category: '自定义', positive: 'CUSTOM_LANDSCAPE', negative: 'CUSTOM_BLUR' }] }), save: async () => {} });
  const controller = createCoreController({ repo, imagePromptLibrary: library, imageModels: { prepare, generate, getModelIdentity: () => 'image-ui-fixture' }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => 'not called' }) }); await controller.initialize(seed);
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  const button = (text: string) => [...node.querySelectorAll('button')].find(row => row.textContent === text)!;
  try {
    await act(async () => root.render(<Core2App controller={controller} repo={repo} />)); await act(async () => button('相册').click());
    expect(button('准备生图预览')).toBeTruthy(); expect(generate).not.toHaveBeenCalled();
    const request = node.querySelector<HTMLTextAreaElement>('textarea[aria-label="图片要求"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(request, 'smiling at Windrise'); request.dispatchEvent(new Event('input', { bubbles: true })); });
    const pending = vi.spyOn(controller, 'prepareImage'); await act(async () => { button('准备生图预览').click(); await vi.waitFor(() => expect(pending).toHaveBeenCalled()); await pending.mock.results[0]!.value; });
    expect(node.querySelector<HTMLTextAreaElement>('textarea[aria-label="生图正面提示词"]')?.value).toContain('Amber, female'); expect(generate).not.toHaveBeenCalled();
    await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); expect(button('测试外景词组')).toBeTruthy(); });
    await act(async () => button('测试外景词组').click());
    expect(node.querySelector('[aria-label="词组正面预览"]')?.textContent).toBe('CUSTOM_LANDSCAPE');
    await act(async () => { button('追加两者').click(); }); await act(async () => { button('追加两者').click(); });
    expect(node.querySelector<HTMLTextAreaElement>('textarea[aria-label="生图正面提示词"]')?.value.match(/CUSTOM_LANDSCAPE/gu)).toHaveLength(1);
    expect(node.querySelector<HTMLTextAreaElement>('textarea[aria-label="生图负面提示词"]')?.value).toContain('CUSTOM_BLUR'); expect(generate).not.toHaveBeenCalled();
    const enqueue = vi.spyOn(controller, 'requestImage'); await act(async () => { button('确认生成图片').click(); await vi.waitFor(() => expect(enqueue).toHaveBeenCalled()); await enqueue.mock.results[0]!.value; await controller.waitForBackground(); });
    await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); expect(node.querySelector('img[alt="旅途照片"]')).not.toBeNull(); });
    expect(generate).toHaveBeenCalledTimes(1); expect(node.textContent).toContain('已加入生图任务');
  } finally { await act(async () => root.unmount()); controller.dispose(); node.remove(); }
});
it('opens the album without a model call, explicitly uploads bytes, binds a phone avatar and removes only the selected album entry', async () => {
  const nativeClone = structuredClone;
  vi.stubGlobal('structuredClone', <T,>(value: T) => cloneInCurrentBinaryRealm(value, nativeClone));
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-album-page-${crypto.randomUUID()}` }), seed = makeSeed(); seed.records = seed.records.filter(row => row.domain !== 'album');
  const generate = vi.fn(async () => { throw Error('NO_MODEL'); }), controller = createCoreController({ repo, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: generate }) });
  await controller.initialize(seed);
  const objectUrls: string[] = [], revoked: string[] = [];
  vi.stubGlobal('URL', class extends URL { static override createObjectURL() { const value = 'blob:test-album-' + objectUrls.length; objectUrls.push(value); return value; } static override revokeObjectURL(value: string) { revoked.push(value); } });
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node), commands = vi.spyOn(controller, 'command'), uploads = vi.spyOn(controller, 'uploadImage');
  const button = (text: string) => [...node.querySelectorAll('button')].find(row => row.textContent === text)!;
  try {
    await act(async () => root.render(<Core2App controller={controller} repo={repo} />)); expect(button('相册')).toBeTruthy();
    await act(async () => button('相册').click()); expect(generate).not.toHaveBeenCalled(); expect((await repo.readHead(seed.head.scope)).coreSeq).toBe(0);
    const file = new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII='), char => char.charCodeAt(0))], 'amber.png', { type: 'image/png' });
    const input = node.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => { Object.defineProperty(input, 'files', { configurable: true, value: [file] }); input.dispatchEvent(new Event('change', { bubbles: true })); });
    const title = node.querySelector<HTMLInputElement>('input[aria-label="图片标题"]')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, '安柏照片'); title.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { button('上传并存入相册').click(); await vi.waitFor(() => expect(uploads).toHaveBeenCalled()); await uploads.mock.results[0]!.value; });
    await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); expect(node.querySelector('img[alt="安柏照片"]')).not.toBeNull(); });
    const target = node.querySelector<HTMLSelectElement>('select[aria-label="图片使用目标"]')!, slot = node.querySelector<HTMLSelectElement>('select[aria-label="图片使用位置"]')!;
    await act(async () => { target.value = 'npc:npc-amber'; target.dispatchEvent(new Event('change', { bubbles: true })); slot.value = 'courier'; slot.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { button('使用这张图片').click(); await commands.mock.results.at(-1)!.value; });
    expect(node.textContent).toContain('已设置到所选位置。');
    expect((await repo.readState(seed.head.scope)).records.find(row => row.domain === 'npc')).toMatchObject({ value: { visualArchive: { slotImages: { courier: expect.stringMatching(/^asset:/u) } } } });
    await act(async () => button('移出当前相册').click());
    await act(async () => { button('确认移出相册').click(); await commands.mock.results.at(-1)!.value; });
    expect((await repo.readState(seed.head.scope)).records.filter(row => row.domain === 'album')).toEqual([]); expect(generate).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); controller.dispose(); node.remove(); expect(revoked.sort()).toEqual(objectUrls.sort()); }
});
