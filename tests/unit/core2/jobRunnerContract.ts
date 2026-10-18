import { expect, it, vi } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import { runCoreJob } from '@/core/jobs/jobRunner';
import { recoverCoreJobs } from '@/core/jobs/jobRecovery';
import { makeSeed, makeMemory } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';
export function assertJobRunnerContract(factory: () => Promise<CoreRepository>): void {
async function fixture() {
  const repo = await factory();
  const seed = makeSeed(), batch = makeBatch(seed);
  await repo.initialize(seed); await prepareBatch(repo, batch); await repo.commit(batch);
  const input = { scope: seed.head.scope, sessionId: seed.head.sessionId, jobId: batch.jobs[0]!.jobId };
  return { repo, seed, batch, input };
}
it('persists successful steps and reuses steps 1–7 when step 8 is explicitly retried', async () => {
  const { repo, input } = await fixture(); let fail = true;
  const calls = Array.from({ length: 8 }, (_, index) => vi.fn(async () => { if (index === 7 && fail) throw Error('step 8 failed'); return []; }));
  const deps = { repo, handlers: { turn_summary: { steps: calls.map((run, index) => ({ stepId: `step-${index + 1}`, run })) } } };
  expect((await runCoreJob(input, deps)).kind).toBe('failed');
  expect((await recoverCoreJobs(repo, input.scope)).items[0]?.job.steps.filter(step => step.status === 'completed')).toHaveLength(7);
  fail = false;
  expect((await runCoreJob(input, deps)).kind).toBe('completed');
  expect(calls.slice(0, 7).map(call => call.mock.calls.length)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  expect(calls[7]).toHaveBeenCalledTimes(2);
  await recoverCoreJobs(repo, input.scope);
  expect(calls[7]).toHaveBeenCalledTimes(2);
});
it('cancels only its own job and does not advance or cancel the committed main turn', async () => {
  const { repo, input, batch } = await fixture(), abort = new AbortController();
  const before = await repo.readState(input.scope);
  const step = vi.fn(async () => { abort.abort(); return []; });
  expect((await runCoreJob({ ...input, signal: abort.signal }, { repo, handlers: { turn_summary: { steps: [{ stepId: 'one', run: step }] } } })).kind).toBe('cancelled');
  expect(await repo.readState(input.scope)).toEqual(before);
  expect((await repo.readOperation(input.scope, batch.operationId))?.status).toBe('committed');
  expect((await repo.queryJobs({ scope: input.scope, cutoffSeq: 1 })).items[0]?.status).toBe('cancelled');
});
it('honors a persisted cancellation from another view before starting the next paid step', async () => {
  const { repo, input } = await fixture(), save = repo.saveJobStep.bind(repo);
  vi.spyOn(repo, 'saveJobStep').mockImplementationOnce(async step => { await save(step); await repo.cancelJob(input.scope, input.jobId); });
  const nextModelCall = vi.fn(async () => []);
  const result = await runCoreJob(input, { repo, handlers: { turn_summary: { steps: [{ stepId: 'first', run: async () => [] }, { stepId: 'second', run: nextModelCall }] } } });
  expect(result.kind).toBe('cancelled'); expect(nextModelCall).not.toHaveBeenCalled();
  expect((await repo.readHead(input.scope)).coreSeq).toBe(1);
});
it('rejects a late step after takeover without publishing into the new session', async () => {
  const { repo, input } = await fixture();
  const before = await repo.readState(input.scope);
  const step = vi.fn(async () => { await repo.activateSession(input.scope, 'new-writer'); return []; });
  expect((await runCoreJob(input, { repo, handlers: { turn_summary: { steps: [{ stepId: 'one', run: step }] } } })).kind).toBe('conflict');
  const after = await repo.readState(input.scope);
  expect(after.records).toEqual(before.records); expect(after.head.memoryRevision).toBe(0);
});
it('reports the durable completion when only the final acknowledgement is lost', async () => {
  const { repo, input } = await fixture();
  const finish = repo.finishJob.bind(repo);
  vi.spyOn(repo, 'finishJob').mockImplementationOnce(async request => { await finish(request); throw Error('lost acknowledgement'); });
  const run = vi.fn(async () => []);
  expect((await runCoreJob(input, { repo, handlers: { turn_summary: { steps: [{ stepId: 'one', run }] } } })).kind).toBe('completed');
  expect(run).toHaveBeenCalledTimes(1);
});
it('reuses a durable publication after its acknowledgement is lost, without republishing or calling the model', async () => {
  const { repo, input, batch } = await fixture();
  const memory = makeMemory({ scope: input.scope, sourceRefs: batch.sourceRefs, eventIds: batch.events.map(event => event.eventId), momentRange: { start: batch.events[0]!.occurredMoment, end: batch.events[0]!.occurredMoment, sourceIds: batch.sourceRefs.map(ref => ref.sourceId) } });
  const publish = repo.publishDerived.bind(repo);
  vi.spyOn(repo, 'publishDerived').mockImplementationOnce(async patch => { await publish(patch); throw Error('publication acknowledgement lost'); });
  const run = vi.fn(async () => [memory]);
  const finalize = vi.fn(async ({ job }: { job: import('@/core/contracts/memory').JobRecord }) => repo.publishDerived({ scope: input.scope, sessionId: input.sessionId, jobId: job.jobId, leaseId: job.leaseId!, sourceRefs: batch.sourceRefs, readSet: [], expectedMemoryRevision: 0, additions: [memory], supersededIds: [] }));
  const deps = { repo, handlers: { turn_summary: { steps: [{ stepId: 'summary', run }], finalize } } };
  expect((await runCoreJob(input, deps)).kind).toBe('completed');
  expect((await runCoreJob(input, deps)).kind).toBe('completed');
  expect(run).toHaveBeenCalledTimes(1); expect(finalize).toHaveBeenCalledTimes(1);
  expect((await repo.readHead(input.scope)).memoryRevision).toBe(1);
});
it('keeps another job of the same kind queued while allowing unrelated kinds to run', async () => {
  const { repo, input, batch } = await fixture();
  const job = batch.jobs[0]!;
  await repo.enqueueJob({ ...job, jobId: 'second-summary' });
  await repo.enqueueJob({ ...job, jobId: 'independent-index', kind: 'index' });
  await repo.claimJob({ ...input, sourceRefs: job.sourceRefs, leaseId: 'other-worker', expectedVersion: 1 });
  const run = vi.fn(async () => []), handlers = { turn_summary: { steps: [{ stepId: 'one', run }] }, index: { steps: [{ stepId: 'index', run }] } };
  expect((await runCoreJob({ ...input, jobId: 'second-summary' }, { repo, handlers })).kind).toBe('conflict');
  expect(run).not.toHaveBeenCalled();
  expect((await runCoreJob({ ...input, jobId: 'independent-index' }, { repo, handlers })).kind).toBe('completed');
});
it('reports published data as completed when cancellation arrives after the atomic publication', async () => {
  const { repo, input, batch } = await fixture(), abort = new AbortController();
  const memory = makeMemory({ scope: input.scope, sourceRefs: batch.sourceRefs, eventIds: batch.events.map(event => event.eventId) });
  const result = await runCoreJob({ ...input, signal: abort.signal }, { repo, handlers: { turn_summary: { steps: [{ stepId: 'summary', run: async () => [memory] }], finalize: async ({ job }) => {
    const receipt = await repo.publishDerived({ scope: input.scope, sessionId: input.sessionId, jobId: job.jobId, leaseId: job.leaseId!, sourceRefs: batch.sourceRefs, readSet: [], expectedMemoryRevision: 0, additions: [memory], supersededIds: [] });
    abort.abort(); return receipt;
  } } } });
  expect(result.kind).toBe('completed');
  expect((await repo.readHead(input.scope)).memoryRevision).toBe(1);
});
}
