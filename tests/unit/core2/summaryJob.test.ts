import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { runCoreTurn } from '@/core/settlement/turnRunner';
import { runCoreSummaryJob } from '@/core/jobs/summaryJob';
import { readCoreSummaryPlan } from '@/core/jobs/summaryPlan';
import { makeSeed } from './fixtures';
import type { MemorySettings } from '@/core/contracts/memory';
async function scenario() {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-summary-job-${crypto.randomUUID()}` }), seed = makeSeed(); await repo.initialize(seed);
  const settings: MemorySettings = { mode: 'model', shortThreshold: 3, middleThreshold: 4, longThreshold: 5, prompt: '最初的整理规则' };
  const result = await runCoreTurn({ scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: 'summary-main', text: '问候' }, { repo, summarySettings: settings,
    rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => JSON.stringify({ body: [{ kind: 'dialogue', speaker: '安柏', text: '云，今天也要一路顺风呀。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }), factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 1 }) });
  if (result.kind !== 'committed') throw Error('fixture');
  return { repo, seed, settings, input: { scope: seed.head.scope, sessionId: seed.head.sessionId, jobId: result.receipt.jobIds[0]! } };
}
it('freezes summary settings in the committed job, publishes independently and never rolls back gameplay', async () => {
  const f = await scenario(); f.settings.prompt = '后来改过的规则';
  const job = (await f.repo.queryJobs({ scope: f.input.scope, cutoffSeq: 1, jobIds: [f.input.jobId] })).items[0]!;
  expect(readCoreSummaryPlan(job).settings.prompt).toBe('最初的整理规则');
  const summarize = vi.fn(async () => ({ kind: 'model' as const, text: '安柏祝愿云一路顺风。' })), before = await f.repo.readState(f.input.scope);
  expect((await runCoreSummaryJob(f.input, { repo: f.repo, summarize })).kind).toBe('completed');
  expect((await runCoreSummaryJob(f.input, { repo: f.repo, summarize })).kind).toBe('completed'); expect(summarize).toHaveBeenCalledTimes(1);
  const after = await f.repo.readState(f.input.scope); expect(after.records).toEqual(before.records); expect(after.head.memoryRevision).toBe(1);
});
it('uses durable publication receipts after an acknowledgement failure and does not call the model twice', async () => {
  const f = await scenario(), publish = f.repo.publishDerived.bind(f.repo);
  vi.spyOn(f.repo, 'publishDerived').mockImplementationOnce(async patch => { await publish(patch); throw Error('lost publication acknowledgement'); });
  const summarize = vi.fn(async () => ({ kind: 'model' as const, text: '安柏祝云一路顺风。' }));
  expect((await runCoreSummaryJob(f.input, { repo: f.repo, summarize })).kind).toBe('completed');
  expect((await runCoreSummaryJob(f.input, { repo: f.repo, summarize })).kind).toBe('completed'); expect(summarize).toHaveBeenCalledTimes(1);
});
it('rejects a frozen summary plan from another scope and does not publish after session takeover', async () => {
  const f = await scenario(), job = (await f.repo.queryJobs({ scope: f.input.scope, cutoffSeq: 1 })).items[0]!;
  expect(() => readCoreSummaryPlan({ ...job, scope: { ...job.scope, branchId: 'another-branch' } })).toThrow('CORE2_SUMMARY_PLAN_BINDING');
  const summarize = vi.fn(async () => { await f.repo.activateSession(f.input.scope, 'new-page'); return { kind: 'model' as const, text: '迟到摘要' }; });
  expect((await runCoreSummaryJob(f.input, { repo: f.repo, summarize })).kind).toBe('conflict'); expect((await f.repo.readHead(f.input.scope)).memoryRevision).toBe(0);
});
