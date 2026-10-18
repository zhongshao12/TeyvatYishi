import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { makeSeed } from './fixtures';
import type { CorePhoneGenerationInput } from '@/core/jobs/phoneJob';
import { exportCorePackage, prepareCoreImport } from '@/core/persistence/packageTransfer';

async function fixture(generate = vi.fn(async (_input: CorePhoneGenerationInput) => ({ text: '云，今天在蒙德城还顺利吗？' })), affinity = 100, identity = 'test-proactive') {
  const seed = makeSeed(), world = seed.records.find(row => row.domain === 'world'), npc = seed.records.find(row => row.domain === 'npc');
  seed.records = seed.records.filter(row => row.domain !== 'album');
  if (world?.domain !== 'world' || npc?.domain !== 'npc') throw Error('fixture');
  world.value.completedMainTurns = 14; world.value.moment.turn = 14; npc.value.affinity = affinity;
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-proactive-runtime-${crypto.randomUUID()}` });
  const controller = createCoreController({ repo, phoneModels: { generate, getModelIdentity: () => identity }, turnDependencies: () => ({
    generateNarrative: async () => JSON.stringify({ body: [{ kind: 'narration', text: '微风吹过蒙德城。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }),
    factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }), assembleContext: async () => ({ systemPrompt: '', messages: [] }), rulePolicy: { ruleVersion: 'test', storyNodes: [] },
  }) });
  await controller.initialize(seed);
  const send = (turn: number) => controller.send({ scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: `proactive-main-${turn}`, text: '继续散步' });
  return { seed, repo, controller, send, generate };
}
it('does not reserve a proactive reply while the phone system is explicitly disabled', async () => {
  const f = await fixture(undefined, 150, 'disabled'); await f.send(15); await f.controller.waitForBackground();
  expect(f.generate).not.toHaveBeenCalled();
  const state = await f.repo.readState(f.seed.head.scope);
  expect(state.records.find(row => row.domain === 'world')?.value).not.toHaveProperty('proactivePending');
  expect((await f.repo.queryJobs({ scope: state.head.scope, cutoffSeq: state.head.coreSeq, kinds: ['courier'] })).items).toEqual([]);
});
it('persists the recall bundle actually delivered for an unsolicited contact', async () => {
  const f = await fixture(); try {
    await f.send(15); await f.controller.waitForBackground();
    const head = await f.repo.readHead(f.seed.head.scope), source = (await f.repo.querySources({ scope: head.scope, cutoffSeq: head.coreSeq, kinds: ['courier'] })).items[0]!;
    const delivered = f.generate.mock.calls[0]![0].context;
    expect(source.delivery).toEqual({ version: 1, bundles: [{ bundleId: delivered.bundle.bundleId, target: 'private', npcIds: ['npc-amber'], selectedLeafIds: delivered.bundle.selectedLeafIds }], worldbookEntryIds: [] });
  } finally { f.controller.dispose(); }
});
it('reserves one global contact at fifteen turns, does not duplicate it while waiting, and starts cooldown at actual delivery', async () => {
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(vi.fn(async () => { enter(); await held; return { text: '云，午后的蒙德还好吗？' }; }));
  await f.send(15);
  const first = await f.repo.readState(f.seed.head.scope), task = (await f.repo.queryJobs({ scope: first.head.scope, cutoffSeq: first.head.coreSeq, kinds: ['courier'] })).items;
  expect(task).toHaveLength(1);
  await entered; await f.send(16);
  expect(f.generate).toHaveBeenCalledTimes(1);
  release(); await f.controller.waitForBackground();
  const state = await f.repo.readState(f.seed.head.scope);
  expect(state.records.find(row => row.domain === 'world')).toMatchObject({ value: { completedMainTurns: 16, proactiveLastTurn: 16 } });
  const messages = (await f.repo.queryEvents({ scope: state.head.scope, cutoffSeq: state.head.coreSeq, types: ['communication.private'] })).items;
  expect(messages).toHaveLength(1); expect(messages[0]!.occurredMoment.turn).toBe(16);
  expect((await f.repo.queryJobs({ scope: state.head.scope, cutoffSeq: state.head.coreSeq, kinds: ['courier'] })).items).toHaveLength(1);
  for (let turn = 17; turn <= 30; turn++) { await f.send(turn); await f.controller.waitForBackground(); }
  expect(f.generate).toHaveBeenCalledTimes(1);
  await f.send(31); await f.controller.waitForBackground(); expect(f.generate).toHaveBeenCalledTimes(2);
});
it('does not burn cooldown or repeatedly call a failed proactive task on later turns; explicit retry can recover it', async () => {
  const generate = vi.fn(async (_input: CorePhoneGenerationInput): Promise<{ text: string }> => { throw Error('TEST_PROACTIVE_TIMEOUT'); }), f = await fixture(generate);
  await f.send(15); await f.controller.waitForBackground();
  await f.send(16); await f.controller.waitForBackground(); expect(generate).toHaveBeenCalledTimes(1);
  const state = await f.repo.readState(f.seed.head.scope), job = (await f.repo.queryJobs({ scope: state.head.scope, cutoffSeq: state.head.coreSeq, kinds: ['courier'], statuses: ['failed'] })).items[0]!;
  expect(state.records.find(row => row.domain === 'world')).toMatchObject({ value: { proactiveLastTurn: 0 } });
  generate.mockImplementation(async () => ({ text: '云，刚才信号不好，现在收到啦。' }));
  expect((await f.controller.retryJob(job.jobId)).kind).toBe('completed'); await f.controller.waitForBackground();
  expect((await f.repo.readState(state.head.scope)).records.find(row => row.domain === 'world')).toMatchObject({ value: { proactiveLastTurn: 16 } });
});
it('does not contact low-affinity or non-contact NPCs and never triggers from merely opening a page', async () => {
  const f = await fixture(undefined, 99); await f.controller.read(); await f.controller.read();
  expect(f.generate).not.toHaveBeenCalled(); await f.send(15); await f.controller.waitForBackground();
  expect(f.generate).not.toHaveBeenCalled();
  const head = await f.repo.readHead(f.seed.head.scope); expect((await f.repo.queryJobs({ scope: head.scope, cutoffSeq: head.coreSeq, kinds: ['courier'] })).items).toEqual([]);
});
it('recovers a pending reservation after export/import using remapped IDs, without granting extra knowledge or rerunning the main turn', async () => {
  const generate = vi.fn(async (_input: CorePhoneGenerationInput): Promise<{ text: string }> => { throw Error('TEST_OFFLINE'); }), f = await fixture(generate);
  await f.send(15); await f.controller.waitForBackground();
  const imported = await prepareCoreImport(await exportCorePackage(f.repo, f.seed.head.scope)); await f.repo.importPrepared(imported);
  const head = await f.controller.attach({ scope: imported.manifest.scope });
  const task = (await f.repo.queryJobs({ scope: head.scope, cutoffSeq: head.coreSeq, kinds: ['courier'] })).items[0]!;
  generate.mockImplementation(async () => ({ text: '云，今天的风很舒服，想起一起走过的街道了。' }));
  expect((await f.controller.retryJob(task.jobId)).kind).toBe('completed'); await f.controller.waitForBackground();
  const state = await f.repo.readState(head.scope); expect(state.records.find(row => row.domain === 'world')).toMatchObject({ value: { completedMainTurns: 15, proactiveLastTurn: 15 } });
  expect((await f.repo.queryEvents({ scope: head.scope, cutoffSeq: state.head.coreSeq, types: ['communication.private'] })).items).toHaveLength(1);
  expect((await f.repo.readState(f.seed.head.scope)).records.find(row => row.domain === 'world')).toMatchObject({ value: { proactiveLastTurn: 0 } });
});
it('does not leave an inherited reservation stuck when continuing an old save on a new branch', async () => {
  const generate = vi.fn(async (_input: CorePhoneGenerationInput): Promise<{ text: string }> => { throw Error('TEST_OFFLINE'); }), f = await fixture(generate);
  await f.send(15); await f.controller.waitForBackground();
  const slot = f.controller.getView().slots.find(row => row.kind === 'auto')!;
  const head = await f.controller.restore(slot.snapshotId); generate.mockImplementation(async () => ({ text: '云，今天还顺利吗？' }));
  expect((await f.controller.send({ scope: head.scope, sessionId: head.sessionId, operationId: 'continued-branch-turn', text: '继续散步' })).kind).toBe('committed');
  await f.controller.waitForBackground();
  expect(generate).toHaveBeenCalledTimes(2);
  const state = await f.repo.readState(head.scope);
  expect((await f.repo.queryEvents({ scope: head.scope, cutoffSeq: state.head.coreSeq, types: ['communication.private'] })).items).toHaveLength(1);
});
