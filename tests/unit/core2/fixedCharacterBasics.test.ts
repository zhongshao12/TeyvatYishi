import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { applyCoreAction } from '@/core/settlement/domainRules';
import { buildCoreImageRequest } from '@/core/retrieval/imageContext';
import { makeSeed, makeCandidate } from './fixtures';

it.each(['appearance', 'clothing', 'personality'] as const)('does not let narrative profile updates rewrite the established %s', field => {
  const seed = makeSeed(), npc = seed.records.find(row => row.domain === 'npc')!; if (npc.domain === 'npc') npc.value.canonical = false;
  const proof = '安柏今后常用穿着改为蓝色骑士常服。';
  const candidate = makeCandidate({ scope: seed.head.scope, status: 'verified', kind: 'profile', proposal: { kind: 'profile', npcId: 'npc-amber', field, value: '蓝色骑士常服' }, evidenceRefs: [{ ref: seed.sources[0]!.ref, blockId: 'body', start: 0, end: proof.length, quote: proof }] });
  const state = { head: seed.head, records: seed.records, contentRefs: [] }, before = structuredClone(state);
  expect(applyCoreAction(state, { kind: 'narrative', actionId: 'base-rewrite', candidate }, { ruleVersion: 'test', storyNodes: [] }).ok).toBe(false);
  expect(state).toEqual(before);
});
it('does not retranslate or replace established English basics when preparing another picture; explicit manual edits reopen preparation', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-fixed-basics-${crypto.randomUUID()}` }), seed = makeSeed();
  const controller = createCoreController({ repo, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: vi.fn(), factModel: vi.fn(), assembleContext: async () => ({ systemPrompt: '', messages: [] }) }) });
  try {
    await controller.initialize(seed);
    const cache = { schemaVersion: 1 as const, sourceKey: '{"name":"安柏","gender":"女"}', preparedAt: 1, facts: { language: 'en' as const, name: 'Amber', gender: 'female' } };
    await controller.command({ type: 'image_profile_cache', npcId: 'npc-amber', expectedVersion: 1, cache });
    const prepare = vi.fn(); await buildCoreImageRequest({ snapshot: controller.getView().snapshot!, npcId: 'npc-amber', userInput: 'Windrise', translationConfig: null }, { prepare }); expect(prepare).not.toHaveBeenCalled();
    await expect(controller.command({ type: 'image_profile_cache', npcId: 'npc-amber', expectedVersion: 2, cache: { ...cache, facts: { ...cache.facts, name: 'Different Amber' } } })).rejects.toThrow('英文基础资料已固定');
    await controller.command({ type: 'edit_npc', npcId: 'npc-amber', field: 'appearance', value: '' });
    expect(controller.getView().snapshot!.records.find(row => row.domain === 'npc')).toHaveProperty('value.visualArchive.englishFacts.facts.name', 'Amber');
    await controller.command({ type: 'edit_npc', npcId: 'npc-amber', field: 'appearance', value: '棕色长发' });
    expect(controller.getView().snapshot!.records.find(row => row.domain === 'npc')).not.toHaveProperty('value.visualArchive.englishFacts');
  } finally { controller.dispose(); }
});
