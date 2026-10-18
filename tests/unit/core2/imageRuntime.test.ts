import { IDBFactory } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { makeSeed } from './fixtures';
it('explicitly prepares a preview, persists its validated English cache and makes no image request until confirmed', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-image-preview-' + crypto.randomUUID() }), seed = makeSeed(), generate = vi.fn();
  const request = { title: '安柏', kind: 'character' as const, npcIds: ['npc-amber'], prompt: 'Amber, female', negative: '', size: '512x512', characters: [{ language: 'en' as const, name: 'Amber', gender: 'female' }] };
  const prepare = vi.fn(async () => ({ request, cache: { npcId: 'npc-amber', expectedVersion: 1, value: { schemaVersion: 1 as const, sourceKey: '{"name":"安柏","gender":"女"}', preparedAt: 1, facts: request.characters[0]! } } }));
  const controller = createCoreController({ repo, imageModels: { prepare, generate, getModelIdentity: () => 'image-v1' }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => 'not called' }) });
  await controller.initialize(seed);
  try {
    expect(await controller.prepareImage({ title: '安柏', kind: 'character', npcId: 'npc-amber', userInput: 'portrait', positive: [], negative: [], size: '512x512' })).toEqual(request);
    expect(generate).not.toHaveBeenCalled(); expect((await repo.readState(seed.head.scope)).records.find(row => row.domain === 'npc')).toMatchObject({ value: { visualArchive: { englishFacts: { facts: { name: 'Amber' } } } } });
  } finally { controller.dispose(); }
});
it('queues explicit image generation, retries a stopped task once, and follows the replacement when stopping from the original failure row', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-image-runtime-' + crypto.randomUUID() }), seed = makeSeed(); seed.records = seed.records.filter(row => row.domain !== 'album');
  let enter!: () => void; let observedSignal: AbortSignal | undefined;
  const generate = vi.fn(async (_request, signal: AbortSignal) => { observedSignal = signal; enter(); return new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('stopped')), { once: true })); });
  const controller = createCoreController({ repo, imageModels: { generate, getModelIdentity: () => 'image-v1' }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => { throw Error('NO_NARRATIVE'); } }) });
  await controller.initialize(seed);
  try {
    let entered = new Promise<void>(resolve => { enter = resolve; });
    const receipt = await controller.requestImage({ title: '风起地', kind: 'scene', npcIds: [], prompt: 'Windrise, landscape', negative: '', size: '512x512', characters: [] }); await entered;
    const jobId = receipt.jobIds[0]!; await controller.stopJob(jobId); await controller.waitForBackground(); expect(observedSignal?.aborted).toBe(true);
    entered = new Promise<void>(resolve => { enter = resolve; }); const retry = controller.retryJob(jobId); await entered;
    await controller.stopJob(jobId); expect((await retry).kind).toBe('cancelled'); await controller.waitForBackground();
    expect(observedSignal?.aborted).toBe(true); expect(generate).toHaveBeenCalledTimes(2);
    const jobs = (await repo.queryJobs({ scope: seed.head.scope, cutoffSeq: (await repo.readHead(seed.head.scope)).coreSeq })).items;
    expect(jobs.filter(job => job.kind === 'image' && job.status === 'cancelled')).toHaveLength(2);
  } finally { controller.dispose(); }
});
