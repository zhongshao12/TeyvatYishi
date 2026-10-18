import { describe, expect, it } from 'vitest';
import type { CoreRepository, PreparedImport } from '@/core/contracts/storage';
import { makeSeed, makeMemory } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';
import { capture, slotFor, nextBatch, publishMemory } from './snapshotRepositoryContract';
import type { SnapshotRepositoryContract } from './snapshotRepositoryContract';
import { assetPublication } from './assetRepositoryContract';
import { checksumUtf8 } from '@/core/sources/sourceIntegrity';
import { stableJson } from '@/core/persistence/repositoryValidation';

export type ImportRepositoryContract = SnapshotRepositoryContract & Pick<CoreRepository, 'importPrepared' | 'readAsset' | 'publishAsset'>;

/** Explicit positions from this one-commit fixture, never inferred from text or timestamps. */
export async function makeImportFixture(repo: ImportRepositoryContract) {
  const seed = makeSeed(); await repo.initialize(seed);
  const baseline = await capture(repo, seed.head.scope); await repo.publishSnapshot(baseline, slotFor(baseline));
  const batch = makeBatch(seed); await prepareBatch(repo, batch); await repo.commit(batch);
  const snapshot = await capture(repo, batch.scope); const slot = slotFor(snapshot); await repo.publishSnapshot(snapshot, slot);
  const publication = assetPublication(seed); publication.asset.assetId = 'asset-fixture'; await repo.publishAsset(publication);
  const committed = (await repo.readOperation(batch.scope, batch.operationId))!;
  const sources = await repo.querySources({ scope: batch.scope, cutoffSeq: 1 });
  const value: PreparedImport = {
    manifest: { kind: 'teyvat-core2-package', formatVersion: 1, scope: batch.scope, snapshotId: snapshot.snapshotId, files: [], containsPrivateData: false },
    branches: [{ playerId: seed.playerId, state: structuredClone(snapshot.state) }],
    sources: sources.items.map(record => ({ record, commitSeq: seed.sources.some(source => source.ref.sourceId === record.ref.sourceId) ? 0 : 1 })),
    events: (await repo.queryEvents({ scope: batch.scope, cutoffSeq: 1 })).items,
    operations: [committed], memories: [],
    knowledge: (await repo.queryKnowledge({ scope: batch.scope, cutoffSeq: 1 })).items.map(record => ({ record, commitSeq: 1 })),
    commitments: (await repo.queryCommitments({ scope: batch.scope, cutoffSeq: 1 })).items.map(record => ({ record, commitSeq: 1 })),
    jobs: (await repo.queryJobs({ scope: batch.scope, cutoffSeq: 1 })).items.map(record => ({ record, commitSeq: 1, leaseIds: [] })),
    snapshots: [baseline, snapshot], slots: [slot], assets: [publication.asset],
  };
  return { value, batch, seed, snapshot, baseline };
}

export function assertImportRepositoryContract(factory: () => Promise<ImportRepositoryContract>): void {
  describe('shared atomic import repository contract', () => {
    async function scenario() {
      const original = await factory(), fixture = await makeImportFixture(original);
      const repo = await factory(); expect(typeof repo.importPrepared).toBe('function');
      return { repo, ...fixture };
    }

    it('publishes the whole journey with original evidence, slots, resources and core receipts', async () => {
      const { repo, value, batch, snapshot } = await scenario();
      expect(await repo.importPrepared(value)).toEqual(snapshot.state.head);
      expect(await repo.readState(batch.scope)).toEqual(snapshot.state);
      expect((await repo.queryEvents({ scope: batch.scope, cutoffSeq: 1 })).items).toEqual(value.events);
      expect((await repo.querySources({ scope: batch.scope, cutoffSeq: 1 })).items.map(row => row.ref)).toEqual(value.sources.map(row => row.record.ref));
      expect((await repo.queryKnowledge({ scope: batch.scope, cutoffSeq: 1 })).items).toEqual(value.knowledge.map(row => row.record));
      expect((await repo.queryCommitments({ scope: batch.scope, cutoffSeq: 1 })).items).toEqual(value.commitments.map(row => row.record));
      expect(await repo.listSaveSlots(batch.scope.journeyId)).toEqual(value.slots);
      expect(Array.from((await repo.readAsset('asset-fixture'))!.bytes)).toEqual([0, 255, 128, 10]);
      expect((await repo.commit(batch)).status).toBe('already_committed');
      const apple = (await repo.readState(batch.scope)).records.find(row => row.entityId === 'apple');
      expect(apple?.domain === 'inventory' && apple.value.kind === 'item' ? apple.value.quantity : undefined).toBe(2);
    });

    it.each(['missing-original-event', 'self'])('rejects imported reply provenance %s before publishing any journey', async target => {
      const { repo, value } = await scenario();
      value.events[0]!.replyToEventId = target === 'self' ? value.events[0]!.eventId : target;
      await expect(repo.importPrepared(value)).rejects.toThrow('CORE2_IMPORT_REPLY_PROVENANCE');
      await expect(repo.readHead(value.manifest.scope)).rejects.toThrow();
    });

    it('does not overwrite an existing journey, even when the imported snapshot is newer', async () => {
      const { repo, value, seed } = await scenario(); await repo.initialize(seed);
      await expect(repo.importPrepared(value)).rejects.toThrow('CORE2_JOURNEY_EXISTS');
      expect((await repo.readHead(seed.head.scope)).coreSeq).toBe(0);
    });

    it('owns the complete input before awaiting a database open', async () => {
      const { repo, value, batch } = await scenario(); const pending = repo.importPrepared(value);
      value.sources[0]!.record.blocks[0]!.text = '改写'; value.assets[0]!.bytes.fill(99); value.branches[0]!.state.records = [];
      await pending;
      expect((await repo.readState(batch.scope)).records).toHaveLength(11);
      expect((await repo.readSource(batch.sourceRefs[0]!))!.blocks[0]!.text).toBe('安柏把一枚苹果放入玩家背包。');
      expect(Array.from((await repo.readAsset('asset-fixture'))!.bytes)).toEqual([0, 255, 128, 10]);
    });

    it('rejects missing evidence and has no visible head afterwards', async () => {
      const { repo, value, batch } = await scenario(); value.sources = value.sources.filter(row => row.commitSeq === 0);
      await expect(repo.importPrepared(value)).rejects.toThrow('CORE2_IMPORT_SOURCE_NOT_REACHABLE');
      await expect(repo.readHead(batch.scope)).rejects.toThrow('CORE2_BRANCH_NOT_FOUND');
      expect(await repo.readAsset('asset-fixture')).toBeNull();
    });

    it('rejects forged positions, event quotes, receipts and current state', async () => {
      const { repo, value } = await scenario();
      for (const mutate of [
        (v: PreparedImport) => { v.sources.find(row => row.commitSeq === 1)!.commitSeq = 2; },
        (v: PreparedImport) => { v.events[0]!.evidenceRefs[0]!.quote = '砂糖把一枚苹果放入玩家背包。'; },
        (v: PreparedImport) => { v.operations[0]!.receipt!.eventIds = []; },
        (v: PreparedImport) => { const row = v.branches[0]!.state.records.find(row => row.domain === 'inventory')!; if (row.domain === 'inventory' && row.value.kind === 'item') row.value.quantity = 999; },
      ]) {
        const changed = structuredClone(value); mutate(changed);
        await expect(repo.importPrepared(changed)).rejects.toThrow(/CORE2_IMPORT_/);
      }
      await expect(repo.readHead(value.manifest.scope)).rejects.toThrow('CORE2_BRANCH_NOT_FOUND');
    });

    it('rejects missing resources, snapshots and cross-journey slots', async () => {
      const { repo, value } = await scenario();
      for (const mutate of [
        (v: PreparedImport) => { v.assets = []; },
        (v: PreparedImport) => { v.snapshots = []; },
        (v: PreparedImport) => { v.slots[0]!.journeyId = 'another-journey'; },
      ]) {
        const changed = structuredClone(value); mutate(changed);
        await expect(repo.importPrepared(changed)).rejects.toThrow(/CORE2_IMPORT_/);
      }
    });

    it('rejects a missing asset in typed NPC/traveler image links even if the album is valid', async () => {
      const {repo,value}=await scenario();
      const assign=(records:typeof value.events[0]['committedChanges'][0]['before'][])=>{
        for(const row of records) if(row?.domain==='npc') row.value.visualArchive.slotImages.courier='asset:missing-avatar';
      };
      value.branches.forEach(row=>assign(row.state.records));
      value.snapshots.forEach(row=>{assign(row.state.records);row.checksum=checksumUtf8(stableJson(row.state));});
      await expect(repo.importPrepared(value)).rejects.toThrow('CORE2_IMPORT_ASSET_MISSING');
      await expect(repo.readHead(value.manifest.scope)).rejects.toThrow('CORE2_BRANCH_NOT_FOUND');
    });

    it('rejects accessor input without running code and rejects legacy format', async () => {
      const { repo, value } = await scenario(); let reads = 0;
      const unsafe = Object.defineProperty({ ...value }, 'events', { enumerable: true, get() { reads++; return value.events; } });
      await expect(repo.importPrepared(unsafe)).rejects.toThrow('CORE2_INVALID_IMPORT'); expect(reads).toBe(0);
      const legacy = { ...value, manifest: { ...value.manifest, kind: 'time-journey-package', formatVersion: 2 } };
      await expect(repo.importPrepared(legacy as unknown as PreparedImport)).rejects.toThrow('CORE2_INVALID_IMPORT');
    });

    it('preserves a closed ancestor chain and does not re-award inherited effects', async () => {
      const original = await factory(), fixture = await makeImportFixture(original);
      const { value, batch, snapshot, seed } = fixture;
      const child = await original.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'import-child', sessionId: 'session-child' });
      const next = await nextBatch(original, child.scope); await prepareBatch(original, next); await original.commit(next);
      const childSnapshot = await capture(original, child.scope);
      await original.publishSnapshot(childSnapshot, slotFor(childSnapshot));
      value.manifest.scope = child.scope; value.manifest.snapshotId = childSnapshot.snapshotId;
      value.branches.push({ playerId: seed.playerId, state: childSnapshot.state, originSnapshotId: snapshot.snapshotId });
      value.snapshots.push(childSnapshot); value.slots.push(slotFor(childSnapshot));
      value.sources.push({ record: (await original.readSource(next.sourceRefs[0]!))!, commitSeq: 2 });
      value.events.push(...(await original.queryEvents({ scope: child.scope, cutoffSeq: 2 })).items.filter(row => row.branchId === child.scope.branchId));
      value.operations.push((await original.readOperation(child.scope, next.operationId))!);
      const repo = await factory(); expect(typeof repo.importPrepared).toBe('function');
      await repo.importPrepared(value);
      expect((await repo.queryEvents({ scope: child.scope, cutoffSeq: 2 })).items).toHaveLength(2);
      const repeated = structuredClone(batch);
      repeated.scope = child.scope; repeated.sessionId = child.sessionId;
      repeated.changes = repeated.changes.map(change => ({ ...change, before: change.before ? { ...change.before, scope: child.scope } : null, after: change.after ? { ...change.after, scope: child.scope } : null }));
      repeated.events = repeated.events.map(event => ({ ...event, branchId: child.scope.branchId, committedChanges: repeated.changes }));
      repeated.knowledge = []; repeated.commitments = []; repeated.jobs = [];
      expect((await repo.commit(repeated)).status).toBe('already_committed');
      expect((await repo.readHead(child.scope)).coreSeq).toBe(2);
      const missingParent = structuredClone(value); missingParent.branches.shift();
      await expect((await factory()).importPrepared(missingParent)).rejects.toThrow('CORE2_IMPORT_LINEAGE');
      const future = structuredClone(value); future.sources.find(row => row.commitSeq === 1)!.commitSeq = 2;
      await expect((await factory()).importPrepared(future)).rejects.toThrow(/CORE2_IMPORT_/);
      const duplicatedEffect = structuredClone(value);
      duplicatedEffect.events.find(event => event.branchId === child.scope.branchId)!.committedChanges[0]!.effectKey = batch.changes[0]!.effectKey;
      duplicatedEffect.operations.find(op => op.scope.branchId === child.scope.branchId)!.effects = [batch.changes[0]!.effectKey];
      await expect((await factory()).importPrepared(duplicatedEffect)).rejects.toThrow('CORE2_IMPORT_EFFECT_REPLAY');
      const ancestorFuture = structuredClone(value);
      const later = await nextBatch(original, batch.scope); await prepareBatch(original, later); await original.commit(later);
      const laterSnapshot = await capture(original, batch.scope); await original.publishSnapshot(laterSnapshot, slotFor(laterSnapshot));
      ancestorFuture.branches[0]!.state = structuredClone(laterSnapshot.state); ancestorFuture.snapshots.push(laterSnapshot);
      ancestorFuture.sources.push({ record: (await original.readSource(later.sourceRefs[0]!))!, commitSeq: 2 });
      ancestorFuture.events.push(...(await original.queryEvents({ scope: batch.scope, cutoffSeq: 2 })).items.filter(row => row.commitSeq === 2));
      ancestorFuture.operations.push((await original.readOperation(batch.scope, later.operationId))!);
      await expect((await factory()).importPrepared(ancestorFuture)).rejects.toThrow('CORE2_IMPORT_LINEAGE_FUTURE');
    });

    it('retains explicit memory revisions and refuses missing summary provenance', async () => {
      const original = await factory(), fixture = await makeImportFixture(original);
      const { value, batch, seed } = fixture;
      await publishMemory(original, batch.scope, batch.sourceRefs, batch.operationId, batch.events[0]!.eventId, '共同吃苹果的回忆');
      const snapshot = await capture(original, batch.scope); await original.publishSnapshot(snapshot, slotFor(snapshot));
      value.branches = [{ playerId: seed.playerId, state: snapshot.state }]; value.snapshots.push(snapshot);
      value.manifest.snapshotId = snapshot.snapshotId;
      const memory = (await original.queryMemories({ scope: batch.scope, cutoffSeq: 1, memoryRevision: 1 })).items[0]!;
      value.memories = [{ record: memory, commitSeq: 1, publishedRevision: 1 }];
      const repo = await factory(); expect(typeof repo.importPrepared).toBe('function'); await repo.importPrepared(value);
      expect((await repo.queryMemories({ scope: batch.scope, cutoffSeq: 1, memoryRevision: 1 })).items.map(row => row.text)).toEqual(['共同吃苹果的回忆']);
      const missing = structuredClone(value); missing.memories[0]!.record.eventIds = ['event-missing'];
      await expect((await factory()).importPrepared(missing)).rejects.toThrow('CORE2_IMPORT_MEMORY_PROVENANCE');
      const wrong = structuredClone(value); wrong.memories[0]!.publishedRevision = 2;
      await expect((await factory()).importPrepared(wrong)).rejects.toThrow('CORE2_IMPORT_POSITION');
    });

    it('keeps deleted entity versions even when the ID contains colons', async () => {
      const { repo, value } = await scenario(); const scope = value.manifest.scope;
      const before = { ...structuredClone(value.branches[0]!.state.records.find(row => row.domain === 'inventory')!), entityId: 'item:apple:gift', version: 1 };
      const change = { ref: { domain: 'inventory' as const, entityId: before.entityId, version: 1 }, before, after: null, effectKey: 'effect-delete-gift' };
      value.snapshots.find(row => row.coreSeq === 0)!.state.records.push(before);
      const tombstone = { domain: 'inventory' as const, entityId: before.entityId, version: 2 };
      value.branches[0]!.state.tombstones!.push(tombstone);
      value.snapshots.find(row => row.coreSeq === 1)!.state.tombstones!.push(tombstone);
      value.events[0]!.committedChanges.push(change); value.operations[0]!.readSet.push(change.ref); value.operations[0]!.effects.push(change.effectKey);
      value.snapshots.forEach(row => { row.checksum = checksumUtf8(stableJson(row.state)); });
      await repo.importPrepared(value);
      expect((await repo.readState(scope)).tombstones).toContainEqual({ domain: 'inventory', entityId: 'item:apple:gift', version: 2 });
    });

    it('restores the original derived receipt without running or republishing a completed job', async () => {
      const original = await factory(), { value, batch, seed } = await makeImportFixture(original);
      const job = value.jobs[0]!.record, leaseId = 'lease-import-fixture';
      await original.claimJob({ scope: job.scope, sessionId: job.sessionId, jobId: job.jobId, leaseId, sourceRefs: job.sourceRefs, expectedVersion: 1 });
      const memory = makeMemory({ scope: batch.scope, sourceRefs: batch.sourceRefs, eventIds: [batch.events[0]!.eventId], text: '原始已完成摘要' });
      const patch = { scope: job.scope, sessionId: job.sessionId, jobId: job.jobId, leaseId, sourceRefs: job.sourceRefs, readSet: [], expectedMemoryRevision: 0, additions: [memory], supersededIds: [] };
      const receipt = await original.publishDerived(patch);
      await original.finishJob({ scope: job.scope, sessionId: job.sessionId, jobId: job.jobId, leaseId, sourceRefs: job.sourceRefs, expectedVersion: 2, status: 'completed' });
      const snapshot = await capture(original, batch.scope); await original.publishSnapshot(snapshot, slotFor(snapshot));
      value.branches = [{ playerId: seed.playerId, state: structuredClone(snapshot.state) }]; value.snapshots.push(snapshot); value.manifest.snapshotId = snapshot.snapshotId;
      value.memories = [{ record: memory, commitSeq: 1, publishedRevision: 1 }];
      const { additions: _additions, ...descriptor } = patch;
      value.jobs = [{ record: (await original.queryJobs({ scope: batch.scope, cutoffSeq: 1 })).items[0]!, commitSeq: 1, leaseIds: [leaseId],
        publication: { leaseId, fingerprint: checksumUtf8(stableJson(patch)), descriptor, receipt } }];
      const repo = await factory(); expect(typeof repo.importPrepared).toBe('function'); await repo.importPrepared(value);
      expect(await repo.publishDerived(patch)).toEqual(receipt);
      expect((await repo.readHead(batch.scope)).memoryRevision).toBe(1);
      const forged = structuredClone(value); forged.jobs[0]!.publication!.receipt.memoryIds = ['memory-missing'];
      await expect((await factory()).importPrepared(forged)).rejects.toThrow('CORE2_IMPORT_JOB_PUBLICATION');
    });

    it('does not accept arbitrary fields in an imported memory record', async () => {
      const { repo, value } = await scenario();
      const row = value.memories as unknown as Record<string, unknown>[];
      row.push({ record: { arbitrary: true }, commitSeq: 1, publishedRevision: 1 });
      await expect(repo.importPrepared(value)).rejects.toThrow('CORE2_INVALID_IMPORT');
    });
  });
}
