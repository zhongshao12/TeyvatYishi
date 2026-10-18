import { IDBFactory } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { makeSeed } from './fixtures';
it('stores only validated English image facts on the matching NPC version and rejects stale profile sources', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-image-cache-' + crypto.randomUUID() }), seed = makeSeed();
  const controller = createCoreController({ repo, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => 'not called' }) });
  await controller.initialize(seed);
  const cache = { schemaVersion: 1 as const, sourceKey: '{"name":"安柏","gender":"女"}', preparedAt: 1, facts: { language: 'en' as const, name: 'Amber', gender: 'female' } };
  try {
    await controller.command({ type: 'image_profile_cache', npcId: 'npc-amber', expectedVersion: 1, cache });
    const first = (await repo.readState(seed.head.scope)).records.find(row => row.domain === 'npc');
    expect(first).toMatchObject({ version: 2, value: { 姓名: '安柏', affinity: 10, visualArchive: { englishFacts: cache } } });
    await controller.command({ type: 'edit_npc', npcId: 'npc-amber', field: 'appearance', value: '棕发' });
    await expect(controller.command({ type: 'image_profile_cache', npcId: 'npc-amber', expectedVersion: 3, cache })).rejects.toThrow();
    expect((await repo.readState(seed.head.scope)).records.find(row => row.domain === 'npc')).toMatchObject({ version: 3, value: { appearance: '棕发' } });
  } finally { controller.dispose(); }
});
