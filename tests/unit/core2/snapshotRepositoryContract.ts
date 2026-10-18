import { describe, expect, it } from 'vitest';
import type { CoreRepository, SaveSlot, SnapshotRecord } from '@/core/contracts/storage';
import type { CoreScope } from '@/core/contracts/identity';
import type { CoreTransactionContract } from './repositoryContract';
import { checksumUtf8 } from '@/core/sources/sourceIntegrity';
import { stableJson } from '@/core/persistence/repositoryValidation';
import { makeSeed, makeSource, makeMemory } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';

export type SnapshotRepositoryContract = CoreTransactionContract & Pick<CoreRepository,
  'publishSnapshot' | 'readSnapshot' | 'listSaveSlots' | 'fork' | 'querySources' | 'queryMemories' |
  'enqueueJob' | 'claimJob' | 'publishDerived' | 'finishJob'>;
export type SnapshotTestFactory = () => Promise<SnapshotRepositoryContract>;

export async function capture(repo: SnapshotRepositoryContract, scope: CoreScope): Promise<SnapshotRecord> {
  const state = await repo.readState(scope);
  return { snapshotId: `snapshot-${crypto.randomUUID()}`, scope, coreSeq: state.head.coreSeq,
    memoryRevision: state.head.memoryRevision, state, createdAt: 10, checksum: checksumUtf8(stableJson(state)) };
}
export function slotFor(snapshot: SnapshotRecord, overrides: Partial<SaveSlot> = {}): SaveSlot {
  return { slotId: `slot-${crypto.randomUUID()}`, journeyId: snapshot.scope.journeyId, kind: 'manual',
    snapshotId: snapshot.snapshotId, turn: 1, name: '云的旅程', updatedAt: 10, ...overrides };
}
export function quantity(snapshot: SnapshotRecord): number | undefined {
  const record = snapshot.state.records.find(row => row.domain === 'inventory' && row.entityId === 'apple');
  return record?.domain === 'inventory' && record.value.kind === 'item' ? record.value.quantity : undefined;
}

export async function nextBatch(repo: CoreTransactionContract, scope: CoreScope) {
  const snapshot = await repo.readState(scope);
  const seed = makeSeed({ head: snapshot.head });
  const batch = makeBatch(seed);
  const source = makeSource({ scope, operationId: `operation-${crypto.randomUUID()}` });
  batch.operationId = source.operationId; batch.sourceRefs = [source.ref];
  const before = snapshot.records.find(row => row.domain === 'inventory' && row.entityId === 'apple')!;
  const after = structuredClone(before); after.version = before.version + 1;
  if (after.domain === 'inventory' && after.value.kind === 'item') after.value.quantity += 1;
  batch.readSet = [{ domain: 'inventory', entityId: 'apple', version: before.version }];
  batch.changes = [{ ref: batch.readSet[0]!, before, after, effectKey: `effect-${crypto.randomUUID()}` }];
  batch.events = [{ ...batch.events[0]!, eventId: `event-${crypto.randomUUID()}`, operationId: batch.operationId,
    evidenceRefs: [{ ref: source.ref, blockId: 'body-1', start: 0, end: 14, quote: '安柏把一枚苹果放入玩家背包。' }],
    committedChanges: structuredClone(batch.changes) }];
  batch.knowledge = []; batch.commitments = []; batch.jobs = [];
  return batch;
}

export async function publishMemory(repo: SnapshotRepositoryContract, scope: CoreScope, sourceRefs: import('@/core/contracts/identity').SourceRef[],
  operationId: string, eventId: string, text: string, readVersion = 0) {
  const head = await repo.readHead(scope), jobId = `job-${crypto.randomUUID()}`, leaseId = `lease-${crypto.randomUUID()}`;
  await repo.enqueueJob({ scope, sessionId: head.sessionId, jobId, sourceRefs, operationId, kind: 'manual_memory',
    status: 'pending', leaseId: null, configFingerprint: 'fixture-v1', attempts: 0, steps: [], version: 1 });
  await repo.claimJob({ scope, sessionId: head.sessionId, jobId, leaseId, sourceRefs, expectedVersion: 1 });
  const memory = makeMemory({ scope, sourceRefs, eventIds: [eventId], text, version: readVersion + 1, editVersion: readVersion,
    momentRange: { start: null, end: null, sourceIds: sourceRefs.map(ref => ref.sourceId) } });
  const receipt = await repo.publishDerived({ scope, sessionId: head.sessionId, jobId, leaseId, sourceRefs,
    expectedMemoryRevision: head.memoryRevision, readSet: readVersion ? [{ memoryId: memory.memoryId, version: readVersion }] : [],
    additions: [memory], supersededIds: [] });
  expect(receipt.status).toBe('published');
  await repo.finishJob({ scope, sessionId: head.sessionId, jobId, leaseId, sourceRefs, expectedVersion: 2, status: 'completed' });
  return receipt;
}

export function assertSnapshotRepositoryContract(factory: SnapshotTestFactory): void {
  describe('shared snapshot and branch repository contract', () => {
    async function scenario() {
      const repo = await factory(), seed = makeSeed();
      await repo.initialize(seed);
      const batch = makeBatch(seed); await prepareBatch(repo, batch); await repo.commit(batch);
      // Missing assembly must fail as an explicit assertion, not a stray TypeError.
      expect(typeof repo.publishSnapshot).toBe('function');
      const snapshot = await capture(repo, batch.scope), slot = slotFor(snapshot);
      await repo.publishSnapshot(snapshot, slot);
      return { repo, seed, batch, snapshot, slot };
    }

    it('updating a manual slot moves its reference but preserves the previous immutable snapshot', async () => {
      const { repo, batch, snapshot, slot } = await scenario();
      const secondBatch = await nextBatch(repo, batch.scope); await prepareBatch(repo, secondBatch); await repo.commit(secondBatch);
      const second = await capture(repo, batch.scope);
      await repo.publishSnapshot(second, { ...slot, snapshotId: second.snapshotId, updatedAt: 20 });
      expect((await repo.listSaveSlots(batch.scope.journeyId)).map(row => row.snapshotId)).toEqual([second.snapshotId]);
      expect(quantity((await repo.readSnapshot(snapshot.snapshotId))!)).toBe(2);
      expect(quantity((await repo.readSnapshot(second.snapshotId))!)).toBe(3);
    });

    it('an existing snapshot ID cannot be overwritten even with a valid checksum of forged content', async () => {
      const { repo, snapshot, slot } = await scenario();
      const altered = structuredClone(snapshot);
      const record = altered.state.records.find(row => row.domain === 'inventory')!;
      if (record.domain === 'inventory' && record.value.kind === 'item') record.value.quantity = 999;
      altered.checksum = checksumUtf8(stableJson(altered.state));
      await expect(repo.publishSnapshot(altered, slot)).rejects.toThrow('CORE2_SNAPSHOT_IMMUTABLE');
      expect(quantity((await repo.readSnapshot(snapshot.snapshotId))!)).toBe(2);
    });

    it('a new snapshot must exactly match durable state rather than trusting a caller checksum', async () => {
      const { repo, batch } = await scenario();
      const forged = await capture(repo, batch.scope);
      const record = forged.state.records.find(row => row.domain === 'inventory')!;
      if (record.domain === 'inventory' && record.value.kind === 'item') record.value.quantity = 999;
      forged.checksum = checksumUtf8(stableJson(forged.state));
      await expect(repo.publishSnapshot(forged, slotFor(forged))).rejects.toThrow('CORE2_SNAPSHOT_STATE_MISMATCH');
      expect(await repo.readSnapshot(forged.snapshotId)).toBeNull();
    });

    it('a captured save cannot silently publish after the active state or session has changed', async () => {
      const { repo, batch } = await scenario();
      const stale = await capture(repo, batch.scope);
      const second = await nextBatch(repo, batch.scope); await prepareBatch(repo, second); await repo.commit(second);
      await expect(repo.publishSnapshot(stale, slotFor(stale))).rejects.toThrow('CORE2_SNAPSHOT_HEAD_CHANGED');
      const current = await capture(repo, batch.scope);
      await repo.activateSession(batch.scope, 'session-new');
      await expect(repo.publishSnapshot(current, slotFor(current))).rejects.toThrow('CORE2_SESSION_CHANGED');
    });

    it('slots cannot be taken over by another journey or changed from manual to auto', async () => {
      const { repo, batch, snapshot, slot } = await scenario();
      await expect(repo.publishSnapshot(snapshot, { ...slot, kind: 'auto' })).rejects.toThrow('CORE2_SLOT_IDENTITY_MISMATCH');
      const other = makeSeed(); await repo.initialize(other);
      const second = await capture(repo, other.head.scope);
      await expect(repo.publishSnapshot(second, slotFor(second, { slotId: slot.slotId }))).rejects.toThrow('CORE2_SLOT_IDENTITY_MISMATCH');
      expect((await repo.listSaveSlots(batch.scope.journeyId))).toHaveLength(1);
      expect(await repo.listSaveSlots(other.head.scope.journeyId)).toEqual([]);
    });

    it('forking an old node after overwriting its manual slot restores the old state and past events only', async () => {
      const { repo, batch, snapshot, slot } = await scenario();
      const secondBatch = await nextBatch(repo, batch.scope); await prepareBatch(repo, secondBatch); await repo.commit(secondBatch);
      const latest = await capture(repo, batch.scope); await repo.publishSnapshot(latest, { ...slot, snapshotId: latest.snapshotId });
      const child = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'branch-child', sessionId: 'session-child' });
      expect(child).toMatchObject({ coreSeq: 1, memoryRevision: 0, forkSeq: 1, forkMemoryRevision: 0 });
      expect((await repo.readState(child.scope)).records.every(record => record.scope.branchId === 'branch-child')).toBe(true);
      expect(quantity(await capture(repo, child.scope))).toBe(2);
      expect((await repo.queryEvents({ scope: child.scope, cutoffSeq: 1 })).items.map(event => event.eventId)).toEqual([batch.events[0]!.eventId]);
      expect((await repo.queryKnowledge({ scope: child.scope, cutoffSeq: 1 })).items.map(row => row.npcId)).toEqual(['npc-amber']);
      expect((await repo.queryCommitments({ scope: child.scope, cutoffSeq: 1 })).items[0]!.status).toBe('pending');
      expect((await repo.queryJobs({ scope: child.scope, cutoffSeq: 1 })).items).toEqual([]);
    });

    it('a fork freezes memory versions, excluding later edits and late summaries of old sources', async () => {
      const { repo, batch } = await scenario();
      await publishMemory(repo, batch.scope, batch.sourceRefs, batch.operationId, batch.events[0]!.eventId, '分叉时的经历。');
      const snapshot = await capture(repo, batch.scope); await repo.publishSnapshot(snapshot, slotFor(snapshot));
      const child = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'branch-child', sessionId: 'session-child' });
      await publishMemory(repo, batch.scope, batch.sourceRefs, batch.operationId, batch.events[0]!.eventId, '父分支后来的校正。', 1);
      expect((await repo.queryMemories({ scope: child.scope, cutoffSeq: 1, memoryRevision: 1 })).items.map(row => row.text)).toEqual(['分叉时的经历。']);
      expect((await repo.queryMemories({ scope: batch.scope, cutoffSeq: 1, memoryRevision: 2 })).items[0]!.text).toBe('父分支后来的校正。');
      const earlier = await repo.readSnapshot(snapshot.snapshotId);
      expect(earlier!.memoryRevision).toBe(1);
    });

    it('editing inherited memory affects only the child and leaves its parent and sibling unchanged', async () => {
      const { repo, batch } = await scenario();
      await publishMemory(repo, batch.scope, batch.sourceRefs, batch.operationId, batch.events[0]!.eventId, '共同的原经历。');
      const snapshot = await capture(repo, batch.scope); await repo.publishSnapshot(snapshot, slotFor(snapshot));
      const child = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'branch-child', sessionId: 'session-child' });
      const sibling = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'branch-sibling', sessionId: 'session-sibling' });
      await publishMemory(repo, child.scope, batch.sourceRefs, batch.operationId, batch.events[0]!.eventId, '仅子分支的校正。', 1);
      expect((await repo.queryMemories({ scope: child.scope, cutoffSeq: 1, memoryRevision: 2 })).items[0]!.text).toBe('仅子分支的校正。');
      for (const scope of [batch.scope, sibling.scope]) expect((await repo.queryMemories({ scope, cutoffSeq: 1, memoryRevision: 1 })).items[0]!.text).toBe('共同的原经历。');
    });

    it('new child settlement can refer to inherited evidence and advance inherited commitment versions', async () => {
      const { repo, batch, snapshot } = await scenario();
      const child = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'branch-child', sessionId: 'session-child' });
      const next = await nextBatch(repo, child.scope);
      next.sourceRefs = batch.sourceRefs; next.events[0]!.evidenceRefs = batch.events[0]!.evidenceRefs;
      next.commitments = [{ ...structuredClone(batch.commitments[0]!), scope: child.scope, version: 2, status: 'fulfilled',
        history: [{ eventId: next.events[0]!.eventId, status: 'fulfilled', moment: next.events[0]!.occurredMoment }] }];
      // Existing ancestor sources are shared; do not upload a scope-relabelled copy.
      await repo.prepareOperation({ scope: next.scope, operationId: next.operationId, kind: 'main', status: 'prepared', sourceRefs: next.sourceRefs,
        readSet: next.readSet, candidateRefs: [], effects: next.changes.map(change => change.effectKey), attempts: 1 });
      await repo.stageOperation({ scope: next.scope, sessionId: next.sessionId, operationId: next.operationId, sourceRefs: next.sourceRefs, candidates: [], review: [], stageVersion: 1 });
      expect((await repo.commit(next)).status).toBe('committed');
      expect((await repo.queryCommitments({ scope: child.scope, cutoffSeq: 2 })).items[0]!.status).toBe('fulfilled');
      expect((await repo.queryCommitments({ scope: batch.scope, cutoffSeq: 1 })).items[0]!.status).toBe('pending');
    });

    it('inherited operation receipts and effect keys prevent awarding the same old event again', async () => {
      const { repo, batch, snapshot } = await scenario();
      const child = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'branch-child', sessionId: 'session-child' });
      const repeated = structuredClone(batch); repeated.scope = child.scope; repeated.sessionId = child.sessionId;
      repeated.changes.forEach(change => { if (change.before) change.before.scope = child.scope; if (change.after) change.after.scope = child.scope; });
      repeated.events.forEach(event => { event.branchId = child.scope.branchId; event.committedChanges = structuredClone(repeated.changes); });
      repeated.knowledge = []; repeated.commitments = []; repeated.jobs = [];
      expect((await repo.commit(repeated)).status).toBe('already_committed');
      const next = await nextBatch(repo, child.scope);
      next.changes[0]!.effectKey = batch.changes[0]!.effectKey; next.events[0]!.committedChanges = structuredClone(next.changes);
      await prepareBatch(repo, next);
      expect((await repo.commit(next)).status).toBe('conflict');
      expect(quantity(await capture(repo, child.scope))).toBe(2);
    });

    it('future ancestor source versions and sibling sources cannot become child evidence', async () => {
      const { repo, batch, snapshot } = await scenario();
      const child = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'branch-child', sessionId: 'session-child' });
      const sibling = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'branch-sibling', sessionId: 'session-sibling' });
      const future = await nextBatch(repo, batch.scope); await prepareBatch(repo, future); await repo.commit(future);
      const siblingBatch = await nextBatch(repo, sibling.scope); await prepareBatch(repo, siblingBatch); await repo.commit(siblingBatch);
      for (const refs of [future.sourceRefs, siblingBatch.sourceRefs]) {
        const next = await nextBatch(repo, child.scope); next.sourceRefs = refs;
        await expect(repo.prepareOperation({ scope: child.scope, operationId: next.operationId, kind: 'main', status: 'prepared', sourceRefs: refs,
          readSet: next.readSet, candidateRefs: [], effects: next.changes.map(change => change.effectKey), attempts: 1 })).rejects.toThrow('CORE2_SOURCE_NOT_REACHABLE');
      }
    });

    it('a nested fork respects both ancestor cutoffs, not the live root head', async () => {
      const { repo, batch, snapshot } = await scenario();
      const child = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'branch-child', sessionId: 'session-child' });
      const own = await nextBatch(repo, child.scope); await prepareBatch(repo, own); await repo.commit(own);
      const childSnapshot = await capture(repo, child.scope); await repo.publishSnapshot(childSnapshot, slotFor(childSnapshot));
      const grandchild = await repo.fork({ snapshotId: childSnapshot.snapshotId, parentScope: child.scope, branchId: 'branch-grandchild', sessionId: 'session-grandchild' });
      const future = await nextBatch(repo, batch.scope); await prepareBatch(repo, future); await repo.commit(future);
      expect((await repo.queryEvents({ scope: grandchild.scope, cutoffSeq: 2 })).items.map(event => event.eventId)).toEqual([batch.events[0]!.eventId, own.events[0]!.eventId]);
      expect(quantity(await capture(repo, grandchild.scope))).toBe(3);
    });

    it('replaying a fork request cannot reset an already advanced child', async () => {
      const { repo, batch, snapshot } = await scenario();
      const request = { snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'branch-child', sessionId: 'session-child' };
      const child = await repo.fork(request);
      const next = await nextBatch(repo, child.scope); await prepareBatch(repo, next); await repo.commit(next);
      expect((await repo.fork(request)).coreSeq).toBe(2);
      expect(quantity(await capture(repo, child.scope))).toBe(3);
      await expect(repo.fork({ ...request, parentScope: { journeyId: 'wrong-journey', branchId: batch.scope.branchId } })).rejects.toThrow('CORE2_FORK_PARENT_MISMATCH');
    });

    it('compression overlays an inherited memory only in its own branch', async () => {
      const { repo, batch } = await scenario();
      await publishMemory(repo, batch.scope, batch.sourceRefs, batch.operationId, batch.events[0]!.eventId, '保留在父分支的经历。');
      const snapshot = await capture(repo, batch.scope); await repo.publishSnapshot(snapshot, slotFor(snapshot));
      const child = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'branch-child', sessionId: 'session-child' });
      const jobId = 'job-child-compression', leaseId = 'lease-child-compression';
      await repo.enqueueJob({ scope: child.scope, sessionId: child.sessionId, jobId, sourceRefs: batch.sourceRefs, operationId: batch.operationId,
        kind: 'compression', status: 'pending', leaseId: null, configFingerprint: 'fixture-v1', attempts: 0, steps: [], version: 1 });
      await repo.claimJob({ scope: child.scope, sessionId: child.sessionId, jobId, leaseId, sourceRefs: batch.sourceRefs, expectedVersion: 1 });
      const compressed = makeMemory({ scope: child.scope, sourceRefs: batch.sourceRefs, eventIds: [batch.events[0]!.eventId], memoryId: 'memory-compressed',
        memoryRefs: [{ memoryId: 'memory-fixture', version: 1 }], text: '子分支的阶段整理。' });
      expect((await repo.publishDerived({ scope: child.scope, sessionId: child.sessionId, jobId, leaseId, sourceRefs: batch.sourceRefs,
        readSet: [{ memoryId: 'memory-fixture', version: 1 }], expectedMemoryRevision: 1, additions: [compressed], supersededIds: ['memory-fixture'] })).status).toBe('published');
      expect((await repo.queryMemories({ scope: child.scope, cutoffSeq: 1, memoryRevision: 2, statuses: ['active'] })).items.map(memory => memory.memoryId)).toEqual(['memory-compressed']);
      expect((await repo.queryMemories({ scope: child.scope, cutoffSeq: 1, memoryRevision: 2, statuses: ['superseded'] })).items[0]!.scope).toEqual(child.scope);
      expect((await repo.queryMemories({ scope: batch.scope, cutoffSeq: 1, memoryRevision: 1, statuses: ['active'] })).items[0]!.text).toBe('保留在父分支的经历。');
    });

    it('a deleted record keeps its expected version after forking and can only be restored with a fresh version', async () => {
      const repo = await factory(), seed = makeSeed(); await repo.initialize(seed);
      const deletion = makeBatch(seed); deletion.changes[0]!.after = null;
      deletion.events[0]!.committedChanges = structuredClone(deletion.changes);
      await prepareBatch(repo, deletion); await repo.commit(deletion);
      const snapshot = await capture(repo, seed.head.scope); await repo.publishSnapshot(snapshot, slotFor(snapshot));
      const child = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: seed.head.scope, branchId: 'branch-child', sessionId: 'session-child' });
      expect((await repo.readState(child.scope)).tombstones).toEqual([{ domain: 'inventory', entityId: 'apple', version: 2 }]);
      const restore = makeBatch(makeSeed({ head: child })); restore.operationId = 'operation-restore';
      restore.knowledge = []; restore.commitments = []; restore.jobs = [];
      const change = restore.changes[0]!; change.before = null; change.ref.version = 0; change.after!.version = 1; change.effectKey = 'effect-restore';
      restore.readSet = [change.ref]; restore.events[0]!.operationId = restore.operationId;
      restore.events[0]!.committedChanges = structuredClone(restore.changes);
      await prepareBatch(repo, restore);
      expect((await repo.commit(restore)).status).toBe('conflict');
      const corrected = structuredClone(restore); corrected.operationId = 'operation-restore-correct'; corrected.sourceRefs = [makeSource().ref];
      corrected.readSet[0]!.version = 2; corrected.changes[0]!.ref.version = 2; corrected.changes[0]!.after!.version = 3;
      corrected.events[0]!.eventId = 'event-restore-correct'; corrected.events[0]!.operationId = corrected.operationId;
      corrected.events[0]!.evidenceRefs[0]!.ref = corrected.sourceRefs[0]!; corrected.events[0]!.committedChanges = structuredClone(corrected.changes);
      await prepareBatch(repo, corrected); expect((await repo.commit(corrected)).status).toBe('committed');
      expect((await repo.readState(child.scope)).tombstones).toEqual([]);
      expect((await repo.readState(seed.head.scope)).tombstones).toHaveLength(1);
    });
  });
}
