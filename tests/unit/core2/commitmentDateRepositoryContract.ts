import { describe, expect, it } from 'vitest';
import type { CommitmentRecord } from '@/core/contracts/knowledge';
import { makeSeed, fixtureMoment } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';
import { capture, nextBatch, slotFor } from './snapshotRepositoryContract';
import type { SnapshotTestFactory } from './snapshotRepositoryContract';

export function assertCommitmentDateRepositoryContract(factory: SnapshotTestFactory): void {
describe('read-only world date commitment queries', () => {
  async function scenario() {
    const repo = await factory();
    const seed = makeSeed(); await repo.initialize(seed);
    const batch = makeBatch(seed), original = batch.commitments[0]!;
    const promise = (id: string, status: CommitmentRecord['status'], trigger: CommitmentRecord['trigger']): CommitmentRecord =>
      ({ ...structuredClone(original), commitmentId: id, status, trigger });
    batch.commitments = [promise('due-date', 'pending', { kind: 'date', date: '旅行历 1000.03.08' }),
      promise('due-clock', 'due', { kind: 'date', date: '旅行历 1000.03.08', clock: '10:30' }),
      promise('future', 'pending', { kind: 'date', date: '旅行历 1000.03.09' }),
      promise('done', 'fulfilled', { kind: 'date', date: '旅行历 1000.03.08' }),
      promise('cancelled', 'cancelled', { kind: 'date', date: '旅行历 1000.03.08' }),
      promise('breached', 'breached', { kind: 'date', date: '旅行历 1000.03.08' }),
      promise('at-location', 'pending', { kind: 'location', locationId: 'mondstadt-city' })];
    await prepareBatch(repo, batch); await repo.commit(batch);
    return { repo, batch };
  }

  it('uses the supplied game date and exact clock boundary, not wall-clock time', async () => {
    const { repo, batch } = await scenario(); const query = { scope: batch.scope, cutoffSeq: 1 };
    expect((await repo.queryCommitments({ ...query, dueAt: { ...fixtureMoment, date: '旅行历 1000.03.07', clock: '23:59' } })).items).toEqual([]);
    expect((await repo.queryCommitments({ ...query, dueAt: { ...fixtureMoment, date: '旅行历 1000.03.08', clock: '10:29' } })).items.map(row => row.commitmentId)).toEqual(['due-date']);
    expect((await repo.queryCommitments({ ...query, dueAt: { ...fixtureMoment, date: '旅行历 1000.03.08', clock: '10:30' } })).items.map(row => row.commitmentId)).toEqual(['due-clock', 'due-date']);
  });

  it('querying due promises does not fulfil them or change world state', async () => {
    const { repo, batch } = await scenario(); const before = await repo.readState(batch.scope);
    const query = { scope: batch.scope, cutoffSeq: 1, dueAt: { ...fixtureMoment, date: '旅行历 1000.03.08' }, statuses: ['pending' as const], limit: 1 };
    expect((await repo.queryCommitments(query)).items.map(row => row.status)).toEqual(['pending']);
    expect(await repo.readState(batch.scope)).toEqual(before);
    expect((await repo.queryCommitments({ scope: batch.scope, cutoffSeq: 1, statuses: ['fulfilled'] })).items.map(row => row.commitmentId)).toEqual(['done']);
  });

  it('keeps the existing 31-day travel-calendar month boundary', async () => {
    const { repo, batch } = await scenario(); const next = await nextBatch(repo, batch.scope);
    next.commitments = [{ ...batch.commitments[0]!, commitmentId: 'calendar-boundary', version: 1,
      establishedEventId: next.events[0]!.eventId, trigger: { kind: 'date', date: '旅行历 1000.02.31', clock: '23:59' } }];
    await prepareBatch(repo, next); await repo.commit(next);
    expect((await repo.queryCommitments({ scope: batch.scope, cutoffSeq: 2, dueAt: { ...fixtureMoment, date: '旅行历 1000.03.01', clock: '00:00' } })).items.map(row => row.commitmentId)).toEqual(['calendar-boundary']);
  });

  it('binds pagination to dueAt and rejects invalid or missing world dates explicitly', async () => {
    const { repo, batch } = await scenario();
    const query = { scope: batch.scope, cutoffSeq: 1, dueAt: { ...fixtureMoment, date: '旅行历 1000.03.10' }, limit: 1 };
    const page = await repo.queryCommitments(query); expect(page.nextCursor).toBeTruthy();
    await expect(repo.queryCommitments({ ...query, dueAt: { ...query.dueAt, clock: '11:00' }, cursor: page.nextCursor })).rejects.toThrow('CORE2_CURSOR_MISMATCH');
    for (const date of [null, '2026.10.14', '琥珀纪 2157.03.07', '旅行历 1000.13.01', '旅行历 1000.01.32']) {
      await expect(repo.queryCommitments({ ...query, dueAt: { ...query.dueAt, date } })).rejects.toThrow('CORE2_INVALID_DUE_TIME');
    }
    await expect(repo.queryCommitments({ ...query, dueAt: { ...query.dueAt, clock: '24:10' } })).rejects.toThrow('CORE2_INVALID_DUE_TIME');
    await expect(repo.queryCommitments({ ...query, dueAt: { ...query.dueAt, date: '旅行历 1000.03.08', clock: null } })).rejects.toThrow('CORE2_DUE_CLOCK_UNKNOWN');
  });

  it('a fork evaluates the past promise version, not future parent fulfilment', async () => {
    const { repo, batch } = await scenario(); const snapshot = await capture(repo, batch.scope); await repo.publishSnapshot(snapshot, slotFor(snapshot));
    const child = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'child', sessionId: 'session-child' });
    const next = await nextBatch(repo, batch.scope);
    next.commitments = [{ ...batch.commitments[0]!, status: 'fulfilled', version: 2,
      history: [{ eventId: next.events[0]!.eventId, status: 'fulfilled', moment: fixtureMoment }] }];
    await prepareBatch(repo, next); await repo.commit(next);
    const dueAt = { ...fixtureMoment, date: '旅行历 1000.03.08' };
    expect((await repo.queryCommitments({ scope: child.scope, cutoffSeq: 1, dueAt, statuses: ['pending'] })).items.map(row => row.commitmentId)).toEqual(['due-date']);
    expect((await repo.queryCommitments({ scope: batch.scope, cutoffSeq: 2, dueAt, statuses: ['pending'] })).items).toEqual([]);
  });
});
}
