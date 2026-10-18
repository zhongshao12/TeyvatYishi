import { expect, it, vi } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import { createCoreController } from '@/core/settlement/coreController';
import { exportCorePackage, prepareCoreImport } from '@/core/persistence/packageTransfer';
import { makeSeed } from './fixtures';

const data = () => ({ version: 'public-fixture-v1', fields: { speechStyle: '爽朗、直接' }, appearanceFacts: { 发色: { value: '棕色', source: 'canon' as const } } });
export function assertProfileCompletionContract(factory: () => Promise<CoreRepository>): void {
  async function setup(read = vi.fn(async () => data())) {
    const repo = await factory(), seed = makeSeed(); seed.records = seed.records.filter(row => row.domain !== 'album');
    const controller = createCoreController({ repo, profileCatalog: { read }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'fixture', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => { throw Error('NO_MAIN_API'); } }) });
    await controller.initialize(seed);
    const jobs = async () => { const scope = controller.getView().snapshot!.head.scope; return (await repo.queryJobs({ scope, cutoffSeq: (await repo.readHead(scope)).coreSeq, kinds: ['profile'], activeAttemptsOnly: true })).items; };
    return { repo, seed, controller, read, jobs };
  }
  it('restores a saved public profile output after acknowledgement loss and package import without rereading the catalog', async () => {
    const f = await setup(), put = f.repo.putSource.bind(f.repo); let lost = false;
    vi.spyOn(f.repo, 'putSource').mockImplementation(async source => { const ref = await put(source); if (source.kind === 'content' && !lost) { lost = true; throw Error('TEST_PROFILE_ACK_LOST'); } return ref; });
    try {
      await f.controller.completeNpcProfile('npc-amber'); await f.controller.waitForBackground(); expect((await f.jobs())[0]?.status).toBe('failed');
      const imported = await prepareCoreImport(await exportCorePackage(f.repo, f.seed.head.scope)); await f.repo.importPrepared(imported); await f.controller.attach({ scope: imported.manifest.scope });
      const worldBeforeRetry = f.controller.getView().snapshot!.records.find(row => row.domain === 'world');
      const job = (await f.jobs())[0]!; expect((await f.controller.retryJob(job.jobId)).kind).toBe('completed'); await f.controller.waitForBackground();
      const state = f.controller.getView().snapshot!; expect(state.records.find(row => row.domain === 'npc')).toMatchObject({ value: { speechStyle: '爽朗、直接', affinity: 10, matureArchive: null } });
      const afterWorld = state.records.find(row => row.domain === 'world'); if (worldBeforeRetry?.domain !== 'world' || afterWorld?.domain !== 'world') throw Error('fixture world missing');
      expect(afterWorld.value).toEqual(worldBeforeRetry.value); expect(afterWorld.value.moment).toMatchObject({ date: '旅行历 1000.03.07', clock: '10:00', travelDay: 1, turn: 1 });
      expect(f.read).toHaveBeenCalledTimes(1); expect((await f.repo.queryKnowledge({ scope: state.head.scope, cutoffSeq: state.head.coreSeq })).items).toEqual([]);
    } finally { f.controller.dispose(); }
  });
  it('can explicitly retry a public profile publication conflict without overwriting the newer player edit', async () => {
    const f = await setup(), commit = f.repo.commit.bind(f.repo); let conflicted = false;
    vi.spyOn(f.repo, 'commit').mockImplementation(async input => {
      if (!conflicted && input.operationId.startsWith('profile-publish-')) { conflicted = true; await f.controller.command({ type: 'edit_npc', npcId: 'npc-amber', field: 'speechStyle', value: '玩家保留的说话方式' }); }
      return commit(input);
    });
    try {
      await f.controller.completeNpcProfile('npc-amber'); await f.controller.waitForBackground(); const failed = (await f.jobs())[0]!; expect(failed.status).toBe('failed');
      expect((await f.controller.retryJob(failed.jobId)).kind).toBe('completed'); await f.controller.waitForBackground();
      expect(f.controller.getView().snapshot!.records.find(row => row.domain === 'npc')).toMatchObject({ value: { speechStyle: '玩家保留的说话方式', appearanceFacts: { 发色: { value: '棕色', source: 'canon' } } } });
      expect((await f.jobs())[0]?.status).toBe('completed');
    } finally { f.controller.dispose(); }
  });
  it('ignores a late public profile after stopping and allows an explicit fresh attempt', async () => {
    let enter!: () => void, release!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const read = vi.fn(async () => { enter(); await held; return data(); }), f = await setup(read);
    try {
      await f.controller.completeNpcProfile('npc-amber'); await entered; const job = (await f.jobs())[0]!; await f.controller.stopJob(job.jobId); release(); await f.controller.waitForBackground();
      expect(f.controller.getView().snapshot!.records.find(row => row.domain === 'npc')).toMatchObject({ value: { speechStyle: '', affinity: 10 } });
      expect((await f.repo.querySources({ scope: f.seed.head.scope, cutoffSeq: (await f.repo.readHead(f.seed.head.scope)).coreSeq, kinds: ['content'] })).items).toEqual([]);
      expect((await f.controller.retryJob(job.jobId)).kind).toBe('completed'); await f.controller.waitForBackground();
      expect(f.controller.getView().snapshot!.records.find(row => row.domain === 'npc')).toMatchObject({ value: { speechStyle: '爽朗、直接' } });
    } finally { release(); f.controller.dispose(); }
  });
  it('rejects unknown or private profile output fields rather than treating them as public baseline data', async () => {
    const read = vi.fn(async () => ({ ...data(), fields: { ...data().fields, matureArchive: 'not a public field' } })), f = await setup(read);
    try {
      await f.controller.completeNpcProfile('npc-amber'); await f.controller.waitForBackground(); const job = (await f.jobs())[0]!;
      expect(job.status).toBe('failed'); expect(job.failure?.detail).toContain('CORE2_PROFILE_OUTPUT_INVALID');
      expect(f.controller.getView().snapshot!.records.find(row => row.domain === 'npc')).toMatchObject({ value: { speechStyle: '', matureArchive: null } });
    } finally { f.controller.dispose(); }
  });
}
