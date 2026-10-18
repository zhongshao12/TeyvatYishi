import { expect, it } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import type { JobRecord } from '@/core/contracts/memory';
import { makeSeed } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';
import { exportCorePackage, prepareCoreImport } from '@/core/persistence/packageTransfer';
import { saveSlot } from '@/core/persistence/saveSlots';
import { nextBatch } from './snapshotRepositoryContract';

export function assertJobRetryContract(factory: () => Promise<CoreRepository>): void {
  async function fixture() {
    const repo = await factory(), seed = makeSeed();
    seed.records = seed.records.filter(row => row.domain !== 'album');
    const batch = makeBatch(seed);
    await repo.initialize(seed); await prepareBatch(repo, batch); await repo.commit(batch);
    const first = batch.jobs[0]!;
    await repo.cancelJob(seed.head.scope, first.jobId);
    const next: JobRecord = { ...first, jobId: 'retry-second', retryOfJobId: first.jobId };
    return { repo, seed, first, next, head: await repo.readHead(seed.head.scope) };
  }
  it('atomically links one replacement, makes enqueue replay idempotent, and rejects a second replacement', async () => {
    const f = await fixture(); await f.repo.enqueueJob(f.next); await f.repo.enqueueJob(f.next);
    const jobs = (await f.repo.queryJobs({ scope: f.head.scope, cutoffSeq: f.head.coreSeq })).items;
    expect(jobs.find(row => row.jobId === f.first.jobId)).toMatchObject({ status: 'cancelled', retriedByJobId: f.next.jobId });
    expect(jobs.find(row => row.jobId === f.next.jobId)).toMatchObject({ retryOfJobId: f.first.jobId });
    await expect(f.repo.enqueueJob({ ...f.next, jobId: 'competing-retry' })).rejects.toThrow('CORE2_JOB_REPLACEMENT_EXISTS');
    expect((await f.repo.queryJobs({ scope: f.head.scope, cutoffSeq: f.head.coreSeq })).items).toHaveLength(2);
    expect((await f.repo.readHead(f.head.scope)).coreSeq).toBe(f.head.coreSeq);
  });
  it('does not let a replacement adopt a different logical operation or replace an unfinished job', async () => {
    const f = await fixture();
    await expect(f.repo.enqueueJob({ ...f.next, operationId: 'unrelated-operation' })).rejects.toThrow();
    await f.repo.enqueueJob(f.next);
    await expect(f.repo.enqueueJob({ ...f.next, jobId: 'retry-third', retryOfJobId: f.next.jobId })).rejects.toThrow('CORE2_JOB_RETRY_NOT_TERMINAL');
    await expect(f.repo.enqueueJob({ ...f.next, jobId: 'self-cycle', retryOfJobId: 'self-cycle' })).rejects.toThrow();
  });
  it('filters replaced attempts before pagination while exact historical IDs remain readable', async () => {
    const f = await fixture(); await f.repo.enqueueJob(f.next);
    const page = await f.repo.queryJobs({ scope: f.head.scope, cutoffSeq: f.head.coreSeq, activeAttemptsOnly: true, limit: 1 });
    expect(page.items.map(row => row.jobId)).toEqual([f.next.jobId]); expect(page.nextCursor).toBeUndefined();
    expect((await f.repo.queryJobs({ scope: f.head.scope, cutoffSeq: f.head.coreSeq, jobIds: [f.first.jobId] })).items).toHaveLength(1);
  });
  it('remaps the attempt chain on independent import and rejects forged or cyclic replacement links', async () => {
    const f = await fixture(); await f.repo.enqueueJob(f.next);
    const transfer = await exportCorePackage(f.repo, f.head.scope);
    const imported = await prepareCoreImport(transfer);
    const previous = imported.jobs.find(row => row.record.retriedByJobId)!, next = imported.jobs.find(row => row.record.retryOfJobId)!;
    expect(previous.record.retriedByJobId).toBe(next.record.jobId); expect(next.record.retryOfJobId).toBe(previous.record.jobId);
    await f.repo.importPrepared(imported);
    const forged = structuredClone(imported); forged.jobs.find(row => row.record.retryOfJobId)!.record.retryOfJobId = 'missing-retry-parent';
    await expect(f.repo.importPrepared(forged)).rejects.toThrow('CORE2_IMPORT_JOB_RETRY');
    const cycle = structuredClone(imported), parent = cycle.jobs.find(row => row.record.retriedByJobId)!.record;
    parent.retryOfJobId = next.record.jobId;
    await expect(f.repo.importPrepared(cycle)).rejects.toThrow('CORE2_IMPORT_JOB_RETRY');
  });
  it('exports an old fork without dangling links to retries created later on its parent', async () => {
    const f = await fixture();
    const slot = await saveSlot(f.repo, { scope: f.head.scope, kind: 'manual', asNew: true, turn: 1, name: '云' });
    const later = await nextBatch(f.repo, f.head.scope); await prepareBatch(f.repo, later); await f.repo.commit(later);
    await f.repo.enqueueJob(f.next);
    const child = await f.repo.fork({ parentScope: f.head.scope, snapshotId: slot.snapshotId, branchId: 'before-retry', sessionId: 'before-retry-session' });
    const transfer = await prepareCoreImport(await exportCorePackage(f.repo, child.scope));
    expect(transfer.jobs).toHaveLength(1);
    expect(transfer.jobs[0]!.record.retriedByJobId).toBeUndefined();
    expect((await f.repo.queryJobs({ scope: f.head.scope, cutoffSeq: 2, jobIds: [f.first.jobId] })).items[0]?.retriedByJobId).toBe(f.next.jobId);
    await f.repo.importPrepared(transfer);
  });
}
