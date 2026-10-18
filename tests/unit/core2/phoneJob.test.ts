import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { commitCoreInteraction } from '@/core/settlement/consumerOperations';
import { runCorePhoneJob } from '@/core/jobs/phoneJob';
import { freezeSource } from '@/core/sources/sourceRecords';
import { makeSeed } from './fixtures';
import { exportCorePackage, prepareCoreImport } from '@/core/persistence/packageTransfer';
import { readCorePhonePlan } from '@/core/jobs/phonePlan';
import { createCoreController } from '@/core/settlement/coreController';
import type { CorePhoneGenerationInput } from '@/core/jobs/phoneJob';

async function setup(exportable = false) {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-phone-job-${crypto.randomUUID()}` }), seed = makeSeed();
  if (exportable) seed.records = seed.records.filter(row => row.domain !== 'album');
  const npc = seed.records.find(row => row.domain === 'npc')!; if (npc.domain !== 'npc') throw Error('fixture');
  seed.records.push({ ...structuredClone(npc), entityId: 'npc-lisa', value: { ...structuredClone(npc.value), id: 'npc-lisa', 姓名: '丽莎', canonicalId: 'lisa' } });
  seed.records.push({ scope: seed.head.scope, domain: 'courier', entityId: 'chat', version: 1, value: { kind: 'conversation', name: '小队', conversationType: 'group', memberIds: ['npc-amber', 'npc-lisa'], dissolved: false, unreadCount: 0, lastReadSeq: 0 } });
  await repo.initialize(seed);
  const source = freezeSource({ scope: seed.head.scope, operationId: 'phone-player-send', kind: 'courier', moment: seed.sources[0]!.moment, blocks: [{ blockId: 'player', kind: 'message', speakerId: seed.playerId, text: '@全体成员 谢谢大家，辛苦啦！' }] });
  const deps = { repo, rulePolicy: { ruleVersion: 'test', storyNodes: [] }, factModel: async () => ({ kind: 'extracted' as const, candidates: [], attempts: 1 }) };
  const receipt = await commitCoreInteraction({ scope: seed.head.scope, sessionId: seed.head.sessionId, source, target: 'group', channelId: 'chat', recipientIds: ['npc-amber', 'npc-lisa'], responsePlan: { npcIds: ['npc-amber', 'npc-lisa'], modelIdentity: 'test-model-v1' } }, deps);
  const jobs = (await repo.queryJobs({ scope: seed.head.scope, cutoffSeq: receipt.coreSeq, kinds: ['courier'] })).items;
  return { repo, seed, source, receipt, jobs, deps };
}
it('atomically saves player messages with one durable job per selected responder', async () => {
  const f = await setup(); expect(f.jobs).toHaveLength(2);
  expect(f.receipt.jobIds).toHaveLength(3); // One summary plus the two replies.
  const events = (await f.repo.queryEvents({ scope: f.seed.head.scope, cutoffSeq: 1, types: ['communication.group'] })).items;
  expect(events).toHaveLength(1); expect(events[0]!.actorIds).toEqual([f.seed.playerId]);
});
it('persists the actual separately delivered recall bundle for each responder, not a diagnostics preview', async () => {
  const f = await setup(), delivered: CorePhoneGenerationInput[] = [];
  for (const job of f.jobs) {
    await runCorePhoneJob({ scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, jobId: job.jobId }, { ...f.deps, getModelIdentity: () => 'test-model-v1', generate: async input => { delivered.push(input); return { text: `${input.npcName}收到消息。` }; } });
    const plan = readCorePhonePlan(job), source = await f.repo.readSource(plan.outputSourceRef), context = delivered.at(-1)!.context;
    expect(source?.delivery).toEqual({ version: 1, bundles: [{ bundleId: context.bundle.bundleId, target: 'group', npcIds: [plan.npcId], selectedLeafIds: context.bundle.selectedLeafIds }], worldbookEntryIds: [] });
  }
  expect(new Set(delivered.map(input => input.context.bundle.bundleId)).size).toBe(2);
});
it('retains each successful reply when another fails, and retries only the failed model', async () => {
  const f = await setup(), generated = vi.fn(async ({ npcName }: { npcName: string }) => { if (npcName === '丽莎') throw Error('test timeout'); return { text: '云，侦察工作就放心交给我吧！' }; });
  const input = (jobId: string) => ({ scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, jobId });
  for (const job of f.jobs) await runCorePhoneJob(input(job.jobId), { ...f.deps, generate: generated, getModelIdentity: () => 'test-model-v1' });
  const head = await f.repo.readHead(f.seed.head.scope), jobs = (await f.repo.queryJobs({ scope: head.scope, cutoffSeq: head.coreSeq, kinds: ['courier'] })).items;
  expect(jobs.map(job => job.status).sort()).toEqual(['completed', 'failed']);
  const failed = jobs.find(job => job.status === 'failed')!, before = generated.mock.calls.length;
  generated.mockImplementation(async () => ({ text: '小可爱，图书馆的茶也已经备好了。' }));
  expect((await runCorePhoneJob(input(failed.jobId), { ...f.deps, generate: generated, getModelIdentity: () => 'test-model-v1' })).kind).toBe('completed');
  expect(generated.mock.calls.length).toBe(before + 1);
  const final = await f.repo.readState(head.scope), events = (await f.repo.queryEvents({ scope: head.scope, cutoffSeq: final.head.coreSeq, types: ['communication.group'] })).items;
  expect(events).toHaveLength(3); expect(events.filter(event => event.actorIds.includes(f.seed.playerId))).toHaveLength(1);
  for (const id of ['npc-amber', 'npc-lisa']) expect(final.records.find(row => row.domain === 'npc' && row.entityId === id)).toMatchObject({ value: { affinity: 12 } });
});
it('recovers a persisted reply after acknowledgement loss without another model request', async () => {
  const f = await setup(), job = f.jobs[0]!, put = f.repo.putSource.bind(f.repo), generate = vi.fn(async () => ({ text: '云，收到啦。' }));
  vi.spyOn(f.repo, 'putSource').mockImplementationOnce(async source => { await put(source); throw Error('lost source acknowledgement'); });
  const input = { scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, jobId: job.jobId }, deps = { ...f.deps, generate, getModelIdentity: () => 'test-model-v1' };
  expect((await runCorePhoneJob(input, deps)).kind).toBe('failed');
  expect((await runCorePhoneJob(input, deps)).kind).toBe('completed'); expect(generate).toHaveBeenCalledTimes(1);
});
it('keeps an already generated reply across export/import even if its first source acknowledgement was lost', async () => {
  const f = await setup(true), job = f.jobs[0]!, put = f.repo.putSource.bind(f.repo), generate = vi.fn(async () => ({ text: '云，这条已经生成的回复不应再次付费。' }));
  vi.spyOn(f.repo, 'putSource').mockImplementationOnce(async source => { await put(source); throw Error('TEST_LOST_OUTPUT_ACK'); });
  expect((await runCorePhoneJob({ scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, jobId: job.jobId }, { ...f.deps, generate, getModelIdentity: () => 'test-model-v1' })).kind).toBe('failed');
  expect(generate).toHaveBeenCalledTimes(1);
  const imported = await prepareCoreImport(await exportCorePackage(f.repo, f.seed.head.scope));
  const restoredJob = imported.jobs.find(row => row.record.kind === 'courier' && row.record.status === 'failed')!.record, plan = readCorePhonePlan(restoredJob);
  expect(imported.sources.find(row => row.record.ref.sourceId === plan.outputSourceRef.sourceId)?.record.blocks[0]?.text).toBe('云，这条已经生成的回复不应再次付费。');
  await f.repo.importPrepared(imported);
  const head = await f.repo.readHead(imported.manifest.scope);
  expect((await runCorePhoneJob({ scope: head.scope, sessionId: head.sessionId, jobId: restoredJob.jobId }, { ...f.deps, generate, getModelIdentity: () => 'test-model-v1' })).kind).toBe('completed');
  expect(generate).toHaveBeenCalledTimes(1);
});
it('finishes an already committed reply after group membership changes without changing its original recipients', async () => {
  const f = await setup(), task = f.jobs[0]!, finish = f.repo.finishJob.bind(f.repo), generate = vi.fn(async () => ({ text: '云，收到。' })); let lost = false;
  vi.spyOn(f.repo, 'finishJob').mockImplementation(async value => { if (!lost && value.jobId === task.jobId && value.status === 'completed') { lost = true; throw Error('TEST_FINISH_ACK_LOST'); } return finish(value); });
  const deps = { ...f.deps, generate, getModelIdentity: () => 'test-model-v1' };
  expect((await runCorePhoneJob({ scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, jobId: task.jobId }, deps)).kind).toBe('failed');
  const controller = createCoreController({ repo: f.repo, turnDependencies: () => ({ ...f.deps, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => '' }) });
  try {
    const head = await controller.attach({ scope: f.seed.head.scope });
    await controller.command({ type: 'group', action: 'remove', conversationId: 'chat', npcId: 'npc-amber' });
    expect((await runCorePhoneJob({ scope: head.scope, sessionId: head.sessionId, jobId: task.jobId }, deps)).kind).toBe('completed');
    expect(generate).toHaveBeenCalledTimes(1);
  } finally { controller.dispose(); }
});
it('does not call a changed model or publish a late reply after another page takes over', async () => {
  const f = await setup(), job = f.jobs[0]!, input = { scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, jobId: job.jobId };
  const generate = vi.fn(async () => { await f.repo.activateSession(input.scope, 'another-page-session'); return { text: '这条迟到回复不能投递。' }; });
  expect((await runCorePhoneJob(input, { ...f.deps, generate, getModelIdentity: () => 'changed-model' })).kind).toBe('conflict'); expect(generate).not.toHaveBeenCalled();
  expect((await runCorePhoneJob(input, { ...f.deps, generate, getModelIdentity: () => 'test-model-v1' })).kind).toBe('conflict');
  expect((await f.repo.readHead(input.scope)).coreSeq).toBe(1);
});

it.each(['cancel', 'model-change'] as const)('does not stage a late reply after durable %s during generation', async action => {
  const f = await setup(), job = f.jobs[0]!;
  let identity = 'test-model-v1';
  const put = vi.spyOn(f.repo, 'putSource');
  const generate = vi.fn(async () => {
    if (action === 'cancel') await f.repo.cancelJob(f.seed.head.scope, job.jobId);
    else identity = 'different-model';
    return { text: '这条已经过期的回复不能保存或投递。' };
  });
  const result = await runCorePhoneJob({ scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, jobId: job.jobId }, { ...f.deps, generate, getModelIdentity: () => identity });
  expect(result.kind).not.toBe('completed'); expect(generate).toHaveBeenCalledTimes(1); expect(put).not.toHaveBeenCalled();
  expect((await f.repo.readHead(f.seed.head.scope)).coreSeq).toBe(1);
});
