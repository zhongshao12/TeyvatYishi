import { describe, expect, it } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import { validateCoreDto } from '@/core/contracts/validation';
import type { DerivedPatch, JobClaim, JobStepResult } from '@/core/contracts/memory';
import { makeMemory, makeSeed } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';
import { checksumUtf8 } from '@/core/sources/sourceIntegrity';
import { stableJson } from '@/core/persistence/repositoryValidation';

export type DerivedRepositoryContract = import('./repositoryContract').CoreTransactionContract & Pick<CoreRepository,
  'enqueueJob' | 'claimJob' | 'finishJob' | 'cancelJob' | 'saveJobStep' | 'publishDerived' | 'queryMemories' | 'readMemoryVersions' | 'publishSnapshot' | 'fork'>;
export type DerivedTestFault = 'derived:memories' | 'derived:receipt';
export type DerivedTestFactory = (fault?: (point: DerivedTestFault) => void) => Promise<{ repo: DerivedRepositoryContract; connect(): Promise<DerivedRepositoryContract> }>;

export function assertDerivedRepositoryContract(factory: DerivedTestFactory): void {
async function scenario(fault?: (point: DerivedTestFault) => void) {
  const { repo, connect } = await factory(fault);
  const seed = makeSeed(), batch = makeBatch(seed);
  await repo.initialize(seed); await prepareBatch(repo, batch); await repo.commit(batch);
  const claim: JobClaim = { scope: batch.scope, sessionId: batch.sessionId, jobId: batch.jobs[0]!.jobId,
    leaseId: 'lease-first', sourceRefs: batch.sourceRefs, expectedVersion: 1 };
  const memory = makeMemory({ scope: batch.scope, sourceRefs: batch.sourceRefs, eventIds: [batch.events[0]!.eventId],
    momentRange: { start: batch.events[0]!.occurredMoment, end: batch.events[0]!.occurredMoment, sourceIds: batch.sourceRefs.map(ref => ref.sourceId) } });
  const patch: DerivedPatch = { scope: batch.scope, sessionId: batch.sessionId, jobId: claim.jobId, leaseId: claim.leaseId,
    sourceRefs: batch.sourceRefs, readSet: [], expectedMemoryRevision: 0, additions: [memory], supersededIds: [] };
  return { connect, repo, seed, batch, claim, patch };
}

describe('derived repository boundaries', () => {
  it('requires a holder identity in the derived DTO rather than only job and session', () => {
    const memory = makeMemory();
    const oldShape = { scope: memory.scope, sessionId: 'session-fixture', jobId: 'job-fixture', sourceRefs: memory.sourceRefs,
      readSet: [], expectedMemoryRevision: 0, additions: [memory], supersededIds: [] };
    expect(validateCoreDto('derived', oldShape).ok).toBe(false);
    expect(validateCoreDto('derived', { ...oldShape, leaseId: 'lease-fixture' }).ok).toBe(true);
  });

  it('derived_publish_does_not_advance_core_clock and retries publish only once', async () => {
    const { repo, batch, claim, patch } = await scenario();
    const before = await repo.readState(batch.scope);
    const claimed = await repo.claimJob(claim);
    expect(claimed?.status).toBe('running');
    const receipt = await repo.publishDerived(patch);
    expect(receipt).toMatchObject({ status: 'published', memoryRevision: 1 });
    expect((await repo.queryJobs({ scope: batch.scope, cutoffSeq: 1 })).items[0]?.publicationReceipt).toEqual(receipt);
    expect(await repo.publishDerived(patch)).toEqual(receipt);
    const after = await repo.readState(batch.scope);
    expect(after.head.coreSeq).toBe(1);
    expect(after.records).toEqual(before.records);
    expect((await repo.queryMemories({ scope: batch.scope, cutoffSeq: 1, memoryRevision: 1 })).items.map(memory => memory.text)).toEqual(['安柏赠送苹果。']);
    expect((await repo.queryMemories({ scope: batch.scope, cutoffSeq: 1, memoryRevision: 0 })).items).toEqual([]);
  });
  it('reads exact historical memory versions within both frozen publication and commit boundaries', async () => {
    const { repo, batch, claim, patch } = await scenario();
    await repo.claimJob(claim); await repo.publishDerived(patch);
    await repo.finishJob({ ...claim, expectedVersion: 2, status: 'completed' });
    const jobId = 'job-edit-version'; await repo.enqueueJob({ ...batch.jobs[0]!, jobId });
    await repo.claimJob({ ...claim, jobId, leaseId: 'edit-version-lease' });
    const first = patch.additions[0]!, second = { ...first, version: 2, text: '后来人工校正的版本' };
    expect((await repo.publishDerived({ ...patch, jobId, leaseId: 'edit-version-lease', expectedMemoryRevision: 1, readSet: [{ memoryId: first.memoryId, version: 1 }], additions: [second] })).status).toBe('published');
    const query = { scope: batch.scope, cutoffSeq: 1, memoryRevision: 2, refs: [{ memoryId: first.memoryId, version: 1 }, { memoryId: first.memoryId, version: 2 }] };
    expect(await repo.readMemoryVersions(query)).toEqual([first, second]);
    expect(await repo.readMemoryVersions({ ...query, memoryRevision: 1 })).toEqual([first]);
    expect(await repo.readMemoryVersions({ ...query, cutoffSeq: 0 })).toEqual([]);
  });

  it('an old holder cannot publish after a same-session retry obtains another lease', async () => {
    const { repo, batch, claim, patch } = await scenario();
    const first = (await repo.claimJob(claim))!;
    await repo.finishJob({ ...claim, expectedVersion: first.version, status: 'failed', failure: { code: 'timeout', detail: '' } });
    const failed = (await repo.queryJobs({ scope: batch.scope, cutoffSeq: 1 })).items[0]!;
    expect(await repo.claimJob({ ...claim, leaseId: 'lease-second', expectedVersion: failed.version })).not.toBeNull();
    expect((await repo.publishDerived(patch)).status).toBe('cancelled');
    expect((await repo.publishDerived({ ...patch, leaseId: 'lease-second' })).status).toBe('published');
  });

  it('unrelated memory append does not stale an independent exact read set', async () => {
    const { repo, batch, claim, patch } = await scenario();
    await repo.claimJob(claim); await repo.publishDerived(patch);
    await repo.finishJob({ ...claim, expectedVersion: 2, status: 'completed' });
    const next = { ...batch.jobs[0]!, jobId: 'job-independent' };
    await repo.enqueueJob(next);
    await repo.claimJob({ ...claim, jobId: next.jobId, leaseId: 'lease-independent' });
    const independent: DerivedPatch = { ...patch, jobId: next.jobId, leaseId: 'lease-independent',
      additions: [{ ...patch.additions[0]!, memoryId: 'memory-independent' }] };
    expect((await repo.publishDerived(independent)).status).toBe('published');
    expect((await repo.readHead(batch.scope)).memoryRevision).toBe(2);
  });

  it('related memory edits reject stale replacement and leave earlier versions queryable', async () => {
    const { repo, batch, claim, patch } = await scenario();
    await repo.claimJob(claim); await repo.publishDerived(patch);
    await repo.finishJob({ ...claim, expectedVersion: 2, status: 'completed' });
    const editing = { ...batch.jobs[0]!, jobId: 'job-editing', kind: 'manual_memory' as const };
    const rebuilding = { ...batch.jobs[0]!, jobId: 'job-rebuilding', kind: 'rebuild' as const };
    await repo.enqueueJob(editing); await repo.enqueueJob(rebuilding);
    await repo.claimJob({ ...claim, jobId: editing.jobId, leaseId: 'lease-editing' });
    await repo.claimJob({ ...claim, jobId: rebuilding.jobId, leaseId: 'lease-rebuilding' });
    const readSet = [{ memoryId: patch.additions[0]!.memoryId, version: 1 }];
    expect((await repo.publishDerived({ ...patch, jobId: editing.jobId, leaseId: 'lease-editing', expectedMemoryRevision: 1, readSet,
      additions: [{ ...patch.additions[0]!, version: 2, text: '玩家手动校正的经历。', generation: { mode: 'manual', version: '1' }, editVersion: 1 }] })).status).toBe('published');
    expect((await repo.publishDerived({ ...patch, jobId: rebuilding.jobId, leaseId: 'lease-rebuilding', expectedMemoryRevision: 1, readSet,
      additions: [{ ...patch.additions[0]!, memoryId: 'memory-rebuilt' }], supersededIds: [readSet[0]!.memoryId] })).status).toBe('conflict');
    expect((await repo.queryMemories({ scope: batch.scope, cutoffSeq: 1, memoryRevision: 2 })).items[0]!.text).toBe('玩家手动校正的经历。');
    expect((await repo.queryMemories({ scope: batch.scope, cutoffSeq: 1, memoryRevision: 1 })).items[0]!.text).toBe('安柏赠送苹果。');
  });

  it('unrelated_memory_change_does_not_stale_core_readset', async () => {
    const { repo, batch, claim, patch } = await scenario();
    const next = structuredClone(batch);
    next.operationId = 'operation-after-memory'; next.sourceRefs = [makeMemory().sourceRefs[0]!];
    next.readSet[0]!.version = 2;
    next.changes[0]!.ref.version = 2; next.changes[0]!.before = structuredClone(batch.changes[0]!.after);
    next.changes[0]!.after!.version = 3; next.changes[0]!.effectKey = 'effect-after-memory';
    next.events[0]!.eventId = 'event-after-memory'; next.events[0]!.operationId = next.operationId;
    next.events[0]!.evidenceRefs[0]!.ref = next.sourceRefs[0]!; next.events[0]!.committedChanges = structuredClone(next.changes);
    next.knowledge = []; next.commitments = []; next.jobs = [];
    await prepareBatch(repo, next);
    await repo.claimJob(claim); await repo.publishDerived(patch);
    expect((await repo.commit(next)).status).toBe('committed');
    expect((await repo.readHead(batch.scope)).coreSeq).toBe(2);
  });

  it('cancelled jobs reject late steps and derived results without losing committed state', async () => {
    const { repo, batch, claim, patch } = await scenario();
    await repo.claimJob(claim); await repo.cancelJob(batch.scope, claim.jobId);
    const step: JobStepResult = { scope: batch.scope, sessionId: claim.sessionId, jobId: claim.jobId, leaseId: claim.leaseId,
      sourceRefs: claim.sourceRefs, stepId: 'step-one', status: 'completed', memories: patch.additions };
    await expect(repo.saveJobStep(step)).rejects.toThrow('CORE2_JOB_HOLDER_CHANGED');
    expect((await repo.publishDerived(patch)).status).toBe('cancelled');
    expect((await repo.readHead(batch.scope)).coreSeq).toBe(1);
    expect((await repo.queryEvents({ scope: batch.scope, cutoffSeq: 1 })).items).toHaveLength(1);
  });

  it('successful steps survive reconnection and cannot be overwritten by a different result', async () => {
    const { connect, repo, batch, claim, patch } = await scenario();
    await repo.claimJob(claim);
    const step: JobStepResult = { scope: batch.scope, sessionId: claim.sessionId, jobId: claim.jobId, leaseId: claim.leaseId,
      sourceRefs: claim.sourceRefs, stepId: 'step-one', status: 'completed', memories: patch.additions };
    await repo.saveJobStep(step); await repo.saveJobStep(step);
    const recovered = await connect();
    const job = (await recovered.queryJobs({ scope: batch.scope, cutoffSeq: 1 })).items[0]!;
    expect(job.steps).toHaveLength(1);
    expect(job.steps[0]!.memories[0]!.text).toBe('安柏赠送苹果。');
    await expect(recovered.saveJobStep({ ...step, memories: [{ ...patch.additions[0]!, text: '覆盖结果' }] })).rejects.toThrow('CORE2_JOB_STEP_IMMUTABLE');
    expect((await recovered.queryMemories({ scope: batch.scope, cutoffSeq: 1, memoryRevision: 0 })).items).toEqual([]);
  });

  it('source and scope mismatches cannot publish fabricated summaries', async () => {
    const { repo, batch, claim, patch } = await scenario();
    await repo.claimJob(claim);
    const forged = makeMemory({ scope: batch.scope, eventIds: [batch.events[0]!.eventId] });
    expect((await repo.publishDerived({ ...patch, additions: [forged] })).status).toBe('conflict');
    expect((await repo.readHead(batch.scope)).memoryRevision).toBe(0);
  });

  it('a finished job returns its original publication receipt on an exact replay', async () => {
    const { repo, batch, claim, patch } = await scenario();
    await repo.claimJob(claim);
    const receipt = await repo.publishDerived(patch);
    await repo.finishJob({ ...claim, expectedVersion: 2, status: 'completed' });
    expect(await repo.publishDerived(patch)).toEqual(receipt);
    expect((await repo.readHead(batch.scope)).memoryRevision).toBe(1);
  });

  it('a retry may not reuse an earlier holder ID after a failed attempt', async () => {
    const { repo, batch, claim } = await scenario();
    await repo.claimJob(claim);
    await repo.finishJob({ ...claim, expectedVersion: 2, status: 'failed', failure: { code: 'timeout', detail: '' } });
    const failed = (await repo.queryJobs({ scope: batch.scope, cutoffSeq: 1 })).items[0]!;
    expect(await repo.claimJob({ ...claim, expectedVersion: failed.version })).toBeNull();
    expect(await repo.claimJob({ ...claim, expectedVersion: failed.version, leaseId: 'lease-new' })).not.toBeNull();
  });

  it('a failed step can be retried by the new holder while successful results stay immutable', async () => {
    const { repo, batch, claim, patch } = await scenario();
    await repo.claimJob(claim);
    const step: JobStepResult = { scope: batch.scope, sessionId: claim.sessionId, jobId: claim.jobId, leaseId: claim.leaseId,
      sourceRefs: claim.sourceRefs, stepId: 'step-one', status: 'failed', memories: [], failure: { code: 'timeout', detail: '' } };
    await repo.saveJobStep(step);
    await repo.finishJob({ ...claim, expectedVersion: 3, status: 'failed', failure: { code: 'timeout', detail: '' } });
    const failed = (await repo.queryJobs({ scope: batch.scope, cutoffSeq: 1 })).items[0]!;
    const retry = (await repo.claimJob({ ...claim, expectedVersion: failed.version, leaseId: 'lease-retry' }))!;
    const { failure: _failure, ...base } = step;
    await repo.saveJobStep({ ...base, leaseId: retry.leaseId!, status: 'completed', memories: patch.additions });
    const recovered = (await repo.queryJobs({ scope: batch.scope, cutoffSeq: 1 })).items[0]!;
    expect(recovered.steps).toHaveLength(1);
    expect(recovered.steps[0]!.status).toBe('completed');
  });

  it('stopping a committed operation cancels only its unfinished tasks and keeps core state', async () => {
    const { repo, batch, claim } = await scenario();
    await repo.claimJob(claim);
    await repo.cancelOperation(batch.scope, batch.operationId);
    expect((await repo.queryJobs({ scope: batch.scope, cutoffSeq: 1 })).items[0]!.status).toBe('cancelled');
    expect((await repo.readOperation(batch.scope, batch.operationId))!.receipt!.status).toBe('committed');
    expect((await repo.readHead(batch.scope)).coreSeq).toBe(1);
  });

  it('failure results require an explicit cause, not a silent failed marker', async () => {
    const { repo, claim } = await scenario();
    await repo.claimJob(claim);
    await expect(repo.finishJob({ ...claim, expectedVersion: 2, status: 'failed' })).rejects.toThrow('CORE2_INVALID_JOBFINISH');
  });

  it.each(['derived:memories', 'derived:receipt'] as const)('a failure at %s publishes neither half a memory nor a revision', async failurePoint => {
    const { repo, connect, batch, claim, patch } = await scenario(point => { if (point === failurePoint) throw new Error('derived-interrupted'); });
    await repo.claimJob(claim);
    await expect(repo.publishDerived(patch)).rejects.toThrow('derived-interrupted');
    const recovered = await connect();
    expect((await recovered.readHead(batch.scope)).memoryRevision).toBe(0);
    expect((await recovered.queryMemories({ scope: batch.scope, cutoffSeq: 1, memoryRevision: 0 })).items).toEqual([]);
    expect((await recovered.publishDerived(patch)).status).toBe('published');
    expect((await recovered.readHead(batch.scope)).coreSeq).toBe(1);
  });

  it('an old session cannot write a saved step or memory after explicit takeover', async () => {
    const { repo, batch, claim, patch } = await scenario();
    await repo.claimJob(claim); await repo.activateSession(batch.scope, 'session-takeover');
    expect((await repo.publishDerived(patch)).status).toBe('cancelled');
    await expect(repo.saveJobStep({ scope: batch.scope, sessionId: claim.sessionId, jobId: claim.jobId, leaseId: claim.leaseId,
      sourceRefs: claim.sourceRefs, stepId: 'step-one', status: 'completed', memories: patch.additions })).rejects.toThrow('CORE2_JOB_HOLDER_CHANGED');
    expect((await repo.readHead(batch.scope)).memoryRevision).toBe(0);
    // Claim is an explicit recovery action, not an automatic paid retry on refresh.
    expect(await repo.claimJob({ ...claim, sessionId: 'session-takeover', leaseId: 'lease-takeover', expectedVersion: 2 })).not.toBeNull();
  });

  it('only one job of a kind can be held within a journey at once', async () => {
    const { repo, batch, claim } = await scenario();
    const second = { ...batch.jobs[0]!, jobId: 'job-second' };
    await repo.enqueueJob(second); await repo.claimJob(claim);
    expect(await repo.claimJob({ ...claim, jobId: second.jobId, leaseId: 'lease-second' })).toBeNull();
    await repo.finishJob({ ...claim, expectedVersion: 2, status: 'completed' });
    expect(await repo.claimJob({ ...claim, jobId: second.jobId, leaseId: 'lease-second' })).not.toBeNull();
  });
  it('queues overlapping automatic summaries and rebuilds before either makes a duplicate model request', async () => {
    const { repo, batch, claim } = await scenario(); await repo.claimJob(claim);
    await repo.enqueueJob({ ...batch.jobs[0]!, jobId: 'same-source-rebuild', kind: 'rebuild' });
    expect(await repo.claimJob({ ...claim, jobId: 'same-source-rebuild', leaseId: 'rebuild-lease' })).toBeNull();
  });
  it('does not let an unfinished task in the parent branch permanently block an independent restored branch', async () => {
    const { repo, batch, claim } = await scenario();
    const state = await repo.readState(batch.scope);
    const snapshot = { snapshotId: 'snapshot-job-branch', scope: batch.scope, coreSeq: state.head.coreSeq, memoryRevision: state.head.memoryRevision, state, createdAt: 0, checksum: checksumUtf8(stableJson(state)) };
    await repo.publishSnapshot(snapshot, { slotId: 'slot-job-branch', journeyId: batch.scope.journeyId, kind: 'manual', snapshotId: snapshot.snapshotId, turn: 1, name: '任务隔离', updatedAt: 0 });
    const child = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'independent-child', sessionId: 'child-writer' });
    await repo.claimJob(claim);
    await repo.enqueueJob({ ...batch.jobs[0]!, jobId: 'child-summary', scope: child.scope, sessionId: child.sessionId });
    expect(await repo.claimJob({ ...claim, jobId: 'child-summary', scope: child.scope, sessionId: child.sessionId, leaseId: 'child-lease' })).not.toBeNull();
  });
});
}
