import { expect, it } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import { makeCommit, makeSeed } from './fixtures';
import { appleQuantity, makeBatch, prepareBatch } from './repositoryContract';

export function assertJobCommitGuardContract(factory: () => Promise<CoreRepository>): void {
  it.each(['valid', 'cancelled', 'stale-version', 'wrong-lease', 'wrong-source'] as const)('checks a %s task lease inside the same core transaction', async mode => {
    const repo = await factory(), seed = makeSeed(), first = makeBatch(seed);
    await repo.initialize(seed); await prepareBatch(repo, first); await repo.commit(first);
    const pending = first.jobs[0]!;
    const job = await repo.claimJob({ scope: seed.head.scope, sessionId: seed.head.sessionId, jobId: pending.jobId, leaseId: 'guard-holder', sourceRefs: pending.sourceRefs, expectedVersion: pending.version });
    if (!job?.leaseId) throw Error('fixture');
    const item = (await repo.readState(seed.head.scope)).records.find(row => row.domain === 'inventory' && row.entityId === 'apple');
    if (item?.domain !== 'inventory' || item.value.kind !== 'item') throw Error('fixture');
    const batch = makeCommit(await repo.readHead(seed.head.scope));
    batch.operationId = 'guarded-follow-up'; batch.sourceRefs = [{ sourceId: 'guarded-follow-up-source', sourceVersion: 1 }];
    batch.readSet = [{ domain: item.domain, entityId: item.entityId, version: item.version }];
    const after = structuredClone(item); after.version++; if (after.value.kind !== 'item') throw Error('fixture'); after.value.quantity++;
    batch.changes = [{ ref: batch.readSet[0]!, before: item, after, effectKey: 'guarded-follow-up-effect' }];
    batch.events[0] = { ...batch.events[0]!, eventId: 'guarded-follow-up-event', operationId: batch.operationId, committedChanges: batch.changes,
      evidenceRefs: batch.events[0]!.evidenceRefs.map(ref => ({ ...ref, ref: batch.sourceRefs[0]! })) };
    batch.jobGuard = { jobId: job.jobId, leaseId: mode === 'wrong-lease' ? 'not-the-holder' : job.leaseId, expectedVersion: job.version + (mode === 'stale-version' ? 1 : 0),
      sourceRefs: mode === 'wrong-source' ? batch.sourceRefs : job.sourceRefs };
    await prepareBatch(repo, batch);
    if (mode === 'cancelled') await repo.cancelJob(batch.scope, job.jobId);
    const receipt = await repo.commit(batch);
    expect(receipt.status).toBe(mode === 'valid' ? 'committed' : mode === 'cancelled' ? 'cancelled' : 'conflict');
    expect(await appleQuantity(repo, seed)).toBe(mode === 'valid' ? 3 : 2);
    if (receipt.status === 'cancelled' || receipt.status === 'conflict') expect(receipt.reason).toBe(mode === 'cancelled' ? 'job_cancelled' : 'job_lease_changed');
    if (mode === 'valid') {
      await repo.cancelJob(batch.scope, job.jobId);
      expect((await repo.commit(batch)).status).toBe('already_committed');
      expect(await appleQuantity(repo, seed)).toBe(3);
    }
  });
}
