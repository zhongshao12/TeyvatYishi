import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { validateCoreDto } from '@/core/contracts/validation';
import { stableJson } from '@/core/persistence/repositoryValidation';
import { makeSeed } from './fixtures';
import { assertSnapshotRepositoryContract, capture, slotFor, quantity } from './snapshotRepositoryContract';
import { makeBatch, prepareBatch } from './repositoryContract';

assertSnapshotRepositoryContract(async () => createIndexedRepository({ databaseName: `test-core2-snapshots-${crypto.randomUUID()}`, factory: new IDBFactory() }));

describe('fork metadata and portable snapshot serialization', () => {
  it('cannot admit a branch head without a frozen memory position', () => {
    const head = makeSeed().head;
    const incomplete = { ...head, parent: { journeyId: head.scope.journeyId, branchId: 'parent-branch' }, forkSeq: 0 };
    expect(validateCoreDto('head', incomplete).ok).toBe(false);
    expect(validateCoreDto('head', { ...incomplete, forkMemoryRevision: 0 }).ok).toBe(true);
    expect(validateCoreDto('head', { ...incomplete, forkMemoryRevision: 1 }).ok).toBe(false);
  });

  it('serializes keys by fixed UTF-16 order, not the system locale', () => {
    expect(stableJson({ a: 1, Z: 2, '🙂': 3, '中': 4, 'é': 5 })).toBe('{"Z":2,"a":1,"é":5,"中":4,"🙂":3}');
  });

  it('keeps numeric-looking keys in the same portable order as ordinary keys', () => {
    expect(stableJson({ '2': 2, '10': 1, a: 3 })).toBe('{"10":1,"2":2,"a":3}');
  });

  it('rejects invalid UTF-16 dictionary keys before snapshot serialization', () => {
    const seed = makeSeed();
    const player = seed.records.find(record => record.domain === 'traveler')!;
    if (player.domain === 'traveler') player.value.attributes = { '\ud800': 1 };
    expect(validateCoreDto('seed', seed).ok).toBe(false);
  });

  it('captures deleted entity versions so a fork cannot reset their conflict protection', async () => {
    const repo = createIndexedRepository({ databaseName: 'test-core2-deleted-version', factory: new IDBFactory() });
    const seed = makeSeed(); await repo.initialize(seed);
    const batch = makeBatch(seed); batch.changes[0]!.after = null;
    batch.events[0]!.committedChanges = structuredClone(batch.changes);
    await prepareBatch(repo, batch); expect((await repo.commit(batch)).status).toBe('committed');
    expect((await repo.readState(batch.scope)).tombstones).toEqual([{ domain: 'inventory', entityId: 'apple', version: 2 }]);
  });
});

describe('snapshot and fork failure boundaries', () => {
  it.each(['snapshot:record', 'snapshot:slot'] as const)('failure at %s preserves the previous slot and no orphan snapshot', async point => {
    const options = { databaseName: `test-core2-snapshot-fault-${crypto.randomUUID()}`, factory: new IDBFactory() };
    const good = createIndexedRepository(options), seed = makeSeed(); await good.initialize(seed);
    const original = await capture(good, seed.head.scope), slot = slotFor(original); await good.publishSnapshot(original, slot);
    const candidate = await capture(good, seed.head.scope);
    const failing = createIndexedRepository({ ...options, fault: failurePoint => { if (failurePoint === point) throw new Error('snapshot-interrupted'); } });
    await expect(failing.publishSnapshot(candidate, { ...slot, snapshotId: candidate.snapshotId })).rejects.toThrow('snapshot-interrupted');
    const recovered = createIndexedRepository(options);
    expect(await recovered.readSnapshot(candidate.snapshotId)).toBeNull();
    expect((await recovered.listSaveSlots(seed.head.scope.journeyId))[0]!.snapshotId).toBe(original.snapshotId);
    expect(quantity((await recovered.readSnapshot(original.snapshotId))!)).toBe(1);
  });

  it.each(['fork:head', 'fork:states'] as const)('failure at %s does not leave a half-initialized branch', async point => {
    const options = { databaseName: `test-core2-fork-fault-${crypto.randomUUID()}`, factory: new IDBFactory() };
    const good = createIndexedRepository(options), seed = makeSeed(); await good.initialize(seed);
    const snapshot = await capture(good, seed.head.scope); await good.publishSnapshot(snapshot, slotFor(snapshot));
    const failing = createIndexedRepository({ ...options, fault: failurePoint => { if (failurePoint === point) throw new Error('fork-interrupted'); } });
    const request = { snapshotId: snapshot.snapshotId, parentScope: seed.head.scope, branchId: 'child', sessionId: 'session-child' };
    await expect(failing.fork(request)).rejects.toThrow('fork-interrupted');
    const recovered = createIndexedRepository(options);
    await expect(recovered.readHead({ journeyId: seed.head.scope.journeyId, branchId: 'child' })).rejects.toThrow('CORE2_BRANCH_NOT_FOUND');
    expect((await recovered.fork(request)).coreSeq).toBe(0);
  });
});
