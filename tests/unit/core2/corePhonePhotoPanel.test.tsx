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
import * as photoContext from '@/core/retrieval/phonePhotoContext';
import { observeReactRepositoryReads } from './reactRepositoryReads';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => vi.unstubAllGlobals());
it('offers one photo action for a finished chat batch and confirms into both the phone gallery and album', async () => {
  const nativeClone = structuredClone; vi.stubGlobal('structuredClone', <T,>(value: T) => cloneInCurrentBinaryRealm(value, nativeClone));
  vi.stubGlobal('URL', class extends URL { static override createObjectURL() { return 'blob:test-phone-photo'; } static override revokeObjectURL() {} });
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-phone-photo-ui-' + crypto.randomUUID() }), seed = makeSeed(); seed.records = seed.records.filter(row => row.domain !== 'album');
  seedAmberImageFacts(seed);
  seed.records.push({ scope: seed.head.scope, domain: 'courier', entityId: 'photo-phone', version: 1, value: { kind: 'conversation', conversationType: 'private', name: '安柏', memberIds: ['npc-amber'], unreadCount: 0, lastReadSeq: 0, dissolved: false } });
  const generate = vi.fn(async () => ({ bytes: Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII='), c => c.charCodeAt(0)), mimeType: 'image/png' }));
  const controller = createCoreController({ repo, phoneModels: { getModelIdentity: () => 'phone-test', generate: async () => ({ text: '可以呀，就在风起地拍一张吧！' }) }, imageModels: { getModelIdentity: () => 'image-test', generate, prepare: async (_snapshot, input) => ({ request: { title: input.title, kind: 'character', npcIds: ['npc-amber'], prompt: 'Amber, smiling at Windrise', negative: '', size: '512x512', characters: [AMBER_IMAGE_FACTS], ...(input.phoneOrigin ? { phoneOrigin: input.phoneOrigin } : {}) } }) }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => 'not called', factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }) }) });
  await controller.initialize(seed); await controller.sendPhone({ conversationId: 'photo-phone', text: '在风起地拍一张照片吧', operationId: 'ask-photo' }); await controller.waitForBackground();
  const contextReads = vi.spyOn(photoContext, 'readCorePhonePhotoBatch');
  const flushReads = observeReactRepositoryReads(repo);
  const flushPhotoReads = async () => { await act(async () => { for (let attempt = 0; attempt < 5; attempt++) { const count = contextReads.mock.results.length; await Promise.allSettled(contextReads.mock.results.map(row => row.value)); if (contextReads.mock.results.length === count) break; } }); };
  // A repository read can mount the photo effect only after React commits that
  // read's result. Drain both sides, not a timed poll with unowned updates in it.
  const settle = async () => {
    let stable = 0;
    for (let pass = 0; pass < 8; pass++) {
      const before = contextReads.mock.results.length;
      await act(async () => { await flushReads(); await flushPhotoReads(); });
      stable = contextReads.mock.results.length === before ? stable + 1 : 0;
      if (stable === 2) return;
    }
    throw Error('phone photo reads did not settle');
  };
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node), button = (text: string) => [...node.querySelectorAll('button')].find(row => row.textContent === text)!;
  try {
    await act(async () => root.render(<Core2App controller={controller} repo={repo} />)); await act(async () => button('手机').click()); await settle();
    expect(button('聊天照片')).toBeTruthy(); expect(button('聊天照片').disabled).toBe(false);
    expect([...node.querySelectorAll('button')].filter(row => row.textContent === '聊天照片')).toHaveLength(1); expect(generate).not.toHaveBeenCalled();
    await act(async () => button('聊天照片').click()); expect(node.querySelector<HTMLTextAreaElement>('[aria-label="图片要求"]')?.value).toBe('在风起地拍一张照片吧');
    await act(async () => { await controller.command({ type: 'contact_remark', contactId: 'contact-amber', remark: '照片验收' }); }); await settle();
    expect(node.querySelector<HTMLTextAreaElement>('[aria-label="图片要求"]')?.value).toBe('在风起地拍一张照片吧');
    const prep = vi.spyOn(controller, 'prepareImage'); await act(async () => { button('准备生图预览').click(); await vi.waitFor(() => expect(prep).toHaveBeenCalled()); await prep.mock.results[0]!.value; }); await settle();
    const enqueue = vi.spyOn(controller, 'requestImage'); await act(async () => { button('确认生成图片').click(); await vi.waitFor(() => expect(enqueue).toHaveBeenCalled()); await enqueue.mock.results[0]!.value; await controller.waitForBackground(); });
    await settle();
    expect(node.querySelector('[aria-label="手机照片"] img')).not.toBeNull();
    expect(generate).toHaveBeenCalledTimes(1); expect((await repo.readState(seed.head.scope)).records.find(row => row.domain === 'album')).toMatchObject({ value: { phoneOrigin: { conversationId: 'photo-phone', npcId: 'npc-amber' } } });
  } finally { await act(async () => root.unmount()); controller.dispose(); node.remove(); }
});
