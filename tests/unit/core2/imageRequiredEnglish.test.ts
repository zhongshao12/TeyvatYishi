import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { ownCoreImageRequest } from '@/core/jobs/imagePlan';
import { makeSeed } from './fixtures';
const request = { title: '照片', kind: 'character' as const, npcIds: ['npc-amber'], prompt: 'a portrait', negative: '', size: '512x512', characters: [] };
it('rejects character image requests that omit the corresponding stored English facts', () => {
  expect(() => ownCoreImageRequest(request)).toThrow('CORE2_IMAGE_ENGLISH_REQUIRED');
});
it('rejects substituted English identity even when its shape is valid and never calls the image API', async () => {
  const seed = makeSeed(), npc = seed.records.find(row => row.domain === 'npc')!; if (npc.domain !== 'npc') throw Error('fixture');
  npc.value.visualArchive.englishFacts = { schemaVersion: 1, sourceKey: '{"name":"安柏","gender":"女"}', preparedAt: 1, facts: { language: 'en', name: 'Amber', gender: 'female' } };
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-required-english-${crypto.randomUUID()}` }), generate = vi.fn();
  const controller = createCoreController({ repo, imageModels: { generate, getModelIdentity: () => 'fixture' }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: vi.fn(), factModel: vi.fn(), assembleContext: async () => ({ systemPrompt: '', messages: [] }) }) });
  try {
    await controller.initialize(seed);
    await expect(controller.requestImage({ ...request, characters: [{ language: 'en', name: 'Lisa', gender: 'female' }] })).rejects.toThrow('CORE2_IMAGE_ENGLISH_MISMATCH');
    expect(generate).not.toHaveBeenCalled();
  } finally { controller.dispose(); }
});
