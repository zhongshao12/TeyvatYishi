import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { makeSeed } from './fixtures';

it('merges only missing public profile fields after a concurrent player edit and leaves private state, affinity and time untouched', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-profile-${crypto.randomUUID()}` }), seed = makeSeed();
  let enter!: () => void, release!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const read = vi.fn(async () => { enter(); await held; return { version: 'fixture-v1', fields: { clothing: '侦察骑士常服', speechStyle: '爽朗、直接' }, appearanceFacts: { 发色: { value: '棕色', source: 'canon' as const } } }; });
  const controller = createCoreController({ repo, profileCatalog: { read }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: vi.fn(), factModel: vi.fn() }) });
  try {
    await controller.initialize(seed); const before = controller.getView().snapshot!;
    await controller.completeNpcProfile('npc-amber'); await entered;
    await controller.command({ type: 'edit_npc', npcId: 'npc-amber', field: 'clothing', value: '玩家选定的常服' });
    release(); await controller.waitForBackground();
    const state = await repo.readState(seed.head.scope), npc = state.records.find(row => row.domain === 'npc')!;
    expect(npc).toMatchObject({ value: { clothing: '玩家选定的常服', speechStyle: '爽朗、直接', affinity: 10, matureArchive: null, appearanceFacts: { 发色: { value: '棕色', source: 'canon' } } } });
    expect(state.records.find(row => row.domain === 'world')).toEqual(before.records.find(row => row.domain === 'world'));
    expect((await repo.queryKnowledge({ scope: state.head.scope, cutoffSeq: state.head.coreSeq })).items).toEqual([]);
    const jobs = (await repo.queryJobs({ scope: state.head.scope, cutoffSeq: state.head.coreSeq, kinds: ['profile'] })).items; expect(jobs).toHaveLength(1); expect(jobs[0]!.status).toBe('completed');
    await controller.retryJob(jobs[0]!.jobId); expect(read).toHaveBeenCalledTimes(1);
  } finally { release(); controller.dispose(); }
});
