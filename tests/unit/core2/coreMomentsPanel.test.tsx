// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { Core2App } from '@/components/features/Core2/Core2App';
import { createCoreController } from '@/core/settlement/coreController';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { makeSeed } from './fixtures';
import { cloneInCurrentBinaryRealm } from './jsdomBinaryClone';
import { observeReactRepositoryReads } from './reactRepositoryReads';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => vi.unstubAllGlobals());

it('uploads a chosen local Moment image explicitly and publishes it as a durable attachment', async () => {
  const nativeClone = structuredClone; vi.stubGlobal('structuredClone', <T,>(value: T) => cloneInCurrentBinaryRealm(value, nativeClone));
  vi.stubGlobal('URL', class extends URL { static override createObjectURL() { return 'blob:moment-upload-fixture'; } static override revokeObjectURL() {} });
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-moment-image-' + crypto.randomUUID() }), seed = makeSeed(); seed.records = seed.records.filter(row => row.domain !== 'album');
  const controller = createCoreController({ repo, phoneModels: { getModelIdentity: () => 'test', generate: async () => ({ text: '这张风景照片真好看！' }) }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => 'not called', factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }) }) }); await controller.initialize(seed);
  const flushReads = observeReactRepositoryReads(repo);
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node), button = (text: string) => [...node.querySelectorAll('button')].find(row => row.textContent === text)!;
  try {
    await act(async () => root.render(<Core2App controller={controller} repo={repo} />)); await act(async () => button('手机').click()); await act(async () => button('朋友圈').click());
    expect(button('生成动态配图')).toBeTruthy();
    const file = new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII='), c => c.charCodeAt(0))], 'windrise.png', { type: 'image/png' });
    const input = node.querySelector<HTMLInputElement>('input[aria-label="选择动态图片"]')!;
    await act(async () => { Object.defineProperty(input, 'files', { configurable: true, value: [file] }); input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect((await repo.readState(seed.head.scope)).records.filter(row => row.domain === 'album')).toEqual([]);
    const uploads = vi.spyOn(controller, 'uploadImage'); await act(async () => { button('上传动态配图').click(); await vi.waitFor(() => expect(uploads).toHaveBeenCalled()); await uploads.mock.results[0]!.value; });
    await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); expect(node.querySelector('[aria-label="已选动态配图"] img')).not.toBeNull(); });
    const command = vi.spyOn(controller, 'command'); await act(async () => { button('发布动态').click(); await vi.waitFor(() => expect(command).toHaveBeenCalled()); await command.mock.results[0]!.value; await controller.waitForBackground(); });
    await flushReads();
    const post = (await repo.readState(seed.head.scope)).records.find(row => row.domain === 'courier' && row.value.kind === 'moment'); expect(post).toMatchObject({ value: { imageAssetIds: [expect.any(String)] } });
    await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); expect(node.querySelector('[data-core-moment] img[alt="旅途配图"]')).not.toBeNull(); });
  } finally { await act(async () => root.unmount()); controller.dispose(); node.remove(); }
});

it('opens Moments without generating, then publishes, edits and deletes through the actual controller', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-moments-ui-${crypto.randomUUID()}` });
  const seed = makeSeed(), generate = vi.fn(async () => ({ text: '风起地的风车，果然很适合拍照呢！' }));
  const controller = createCoreController({ repo, phoneModels: { generate, getModelIdentity: () => 'test' }, turnDependencies: () => ({
    rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: vi.fn(), assembleContext: async () => ({ systemPrompt: '', messages: [] }), factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }),
  }) });
  await controller.initialize(seed);
  const commands = vi.spyOn(controller, 'command');
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  try {
    await act(async () => root.render(<Core2App controller={controller} repo={repo} />));
    const button = (text: string) => [...node.querySelectorAll('button')].find(row => row.textContent === text)!;
    await act(async () => button('手机').click());
    expect(button('朋友圈')).toBeTruthy();
    await act(async () => button('朋友圈').click()); expect(generate).not.toHaveBeenCalled();
    const textarea = node.querySelector('[aria-label="分享旅途见闻"]') as HTMLTextAreaElement;
    const set = async (text: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, text); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
    await set('今天在风起地看风车。');
    await act(async () => { button('发布动态').click(); await commands.mock.results.at(-1)!.value; await controller.waitForBackground(); });
    await act(async () => { const head = await repo.readHead(seed.head.scope);
      expect((await repo.queryJobs({ scope: head.scope, cutoffSeq: head.coreSeq, kinds: ['courier'] })).items.map(job => ({ status: job.status, failure: job.failure }))).toEqual([{ status: 'completed', failure: undefined }]); });
    for (let i = 0; i < 100 && !node.textContent?.includes('风起地的风车，果然很适合拍照呢！'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(node.textContent).toContain('风起地的风车，果然很适合拍照呢！');
    expect(node.textContent).toContain('今天在风起地看风车。'); expect(generate).toHaveBeenCalledTimes(1);
    await act(async () => button('编辑动态').click()); await set('更正：今天在晨曦酒庄。');
    await act(async () => { button('保存动态').click(); await commands.mock.results.at(-1)!.value; await controller.waitForBackground(); });
    for (let i = 0; i < 100 && !node.textContent?.includes('更正：今天在晨曦酒庄。'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(node.textContent).toContain('更正：今天在晨曦酒庄。');
    expect(node.textContent).not.toContain('今天在风起地看风车。');
    await act(async () => button('删除动态').click());
    const confirmation = button('确认删除这条动态'); expect(confirmation).toBeTruthy();
    await act(async () => { confirmation.click(); await vi.waitFor(() => expect(controller.getView().snapshot!.records.some(row => row.domain === 'courier' && row.value.kind === 'moment')).toBe(false)); });
  } finally { await act(async () => root.unmount()); controller.dispose(); node.remove(); }
});
