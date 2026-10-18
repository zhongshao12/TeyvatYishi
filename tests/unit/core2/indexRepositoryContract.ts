import { describe, expect, it } from 'vitest';
import type { CoreRepository, IndexPatch, IndexPosting } from '@/core/contracts/storage';
import { makeSeed } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';
import { capture, nextBatch, publishMemory, slotFor } from './snapshotRepositoryContract';
import type { SnapshotRepositoryContract } from './snapshotRepositoryContract';

export type IndexRepositoryContract = SnapshotRepositoryContract & Pick<CoreRepository, 'readIndexStatus' | 'publishIndex'|'queryPostings'>;

export function eventIndex(batch: ReturnType<typeof makeBatch>, expectedIndexVersion = 0): IndexPatch {
  return { scope: batch.scope, sessionId: batch.sessionId, cutoffSeq: 1, memoryRevision: 0, expectedIndexVersion,
    postings: [{ scope: batch.scope, kind: 'type', key: 'inventory', target: 'event', targetId: batch.events[0]!.eventId, commitSeq: 1, memoryRevision: 0 }] };
}

export function assertIndexRepositoryContract(factory: () => Promise<IndexRepositoryContract>): void {
  describe('shared index publication contract', () => {
    async function scenario() {
      const repo = await factory(), seed = makeSeed(); await repo.initialize(seed);
      const batch = makeBatch(seed); await prepareBatch(repo, batch); await repo.commit(batch);
      expect(typeof repo.readIndexStatus).toBe('function');
      expect(typeof repo.publishIndex).toBe('function');
      return { repo, seed, batch, patch: eventIndex(batch) };
    }

    it('reports missing until publication, then durable ready without advancing world state', async () => {
      const { repo, batch, patch } = await scenario(); const before = await repo.readHead(batch.scope);
      expect(await repo.readIndexStatus(batch.scope)).toEqual({ scope: batch.scope, coreSeq: 0, memoryRevision: 0, indexVersion: 0, status: 'missing' });
      expect(await repo.publishIndex(patch)).toEqual({ status: 'published', indexVersion: 1 });
      expect(await (await factory()).readIndexStatus(batch.scope)).toEqual({ scope: batch.scope, coreSeq: 1, memoryRevision: 0, indexVersion: 1, status: 'ready' });
      expect(await repo.readHead(batch.scope)).toEqual(before);
    });
    it('pages candidate postings and refuses a lagging cache instead of returning a falsely complete page',async()=>{
      const {repo,batch,patch}=await scenario();
      patch.postings=Array.from({length:51},(_,index)=>({...patch.postings[0]!,key:`key-${String(index).padStart(3,'0')}`}));
      await repo.publishIndex(patch);
      const query={scope:batch.scope,cutoffSeq:1,memoryRevision:0};
      const first=await repo.queryPostings(query);expect(first.items).toHaveLength(50);expect(first.nextCursor).toBeTruthy();
      expect((await repo.queryPostings({...query,cursor:first.nextCursor})).items).toHaveLength(1);
      await expect(repo.queryPostings({...query,limit:201})).rejects.toThrow();
      await expect(repo.queryPostings({...query,keys:['different'],cursor:first.nextCursor})).rejects.toThrow('CORE2_CURSOR_MISMATCH');
      await publishMemory(repo,batch.scope,batch.sourceRefs,batch.operationId,batch.events[0]!.eventId,'新记忆');
      await expect(repo.queryPostings({...query,memoryRevision:1})).rejects.toThrow('CORE2_INDEX_POSITION_MISMATCH');
    });

    it('reports lagging after core or derived advancement, never falsely ready', async () => {
      const { repo, batch, patch } = await scenario(); await repo.publishIndex(patch);
      await publishMemory(repo, batch.scope, batch.sourceRefs, batch.operationId, batch.events[0]!.eventId, '苹果的共同回忆');
      expect((await repo.readIndexStatus(batch.scope)).status).toBe('lagging');
      const updated = { ...patch, memoryRevision: 1, expectedIndexVersion: 1 };
      expect((await repo.publishIndex(updated)).status).toBe('published');
      const next = await nextBatch(repo, batch.scope); await prepareBatch(repo, next); await repo.commit(next);
      expect(await repo.readIndexStatus(batch.scope)).toMatchObject({ coreSeq: 1, memoryRevision: 1, status: 'lagging' });
    });

    it('only one of two concurrent publishers can advance the same index version', async () => {
      const { repo, patch } = await scenario(); const other = await factory();
      const receipts = await Promise.all([repo.publishIndex(patch), other.publishIndex(patch)]);
      expect(receipts.map(row => row.status).sort()).toEqual(['conflict', 'published']);
      expect((await repo.readIndexStatus(patch.scope)).indexVersion).toBe(1);
    });

    it('rejects stale session and future positions without publishing anything', async () => {
      const { repo, patch } = await scenario();
      expect(await repo.publishIndex({ ...patch, cutoffSeq: 2 })).toMatchObject({ status: 'conflict', reason: 'future_index_position' });
      expect(await repo.publishIndex({ ...patch, memoryRevision: 1 })).toMatchObject({ status: 'conflict', reason: 'future_index_position' });
      await repo.activateSession(patch.scope, 'session-new');
      expect(await repo.publishIndex(patch)).toMatchObject({ status: 'cancelled', reason: 'session_changed' });
      expect((await repo.readIndexStatus(patch.scope)).status).toBe('missing');
    });

    it('allows a lagging build but never moves an existing index backwards', async () => {
      const { repo, batch, patch } = await scenario();
      const next = await nextBatch(repo, batch.scope); await prepareBatch(repo, next); await repo.commit(next);
      expect((await repo.publishIndex(patch)).status).toBe('published');
      expect((await repo.readIndexStatus(batch.scope)).status).toBe('lagging');
      expect((await repo.publishIndex({ ...patch, cutoffSeq: 2, expectedIndexVersion: 1 })).status).toBe('published');
      expect(await repo.publishIndex({ ...patch, expectedIndexVersion: 2 })).toMatchObject({ status: 'conflict', reason: 'index_position_regressed' });
      expect((await repo.readIndexStatus(batch.scope)).status).toBe('ready');
    });

    it('rejects phantom, misplaced and duplicate postings', async () => {
      const { repo, patch } = await scenario();
      const first = patch.postings[0]!;
      for (const posting of [{ ...first, targetId: 'event-missing' }, { ...first, commitSeq: 0 }, { ...first, memoryRevision: 1 }]) {
        expect(await repo.publishIndex({ ...patch, postings: [posting] })).toMatchObject({ status: 'conflict', reason: 'invalid_index_target' });
      }
      expect(await repo.publishIndex({ ...patch, postings: [first, first] })).toMatchObject({ status: 'conflict', reason: 'duplicate_index_posting' });
      expect((await repo.readIndexStatus(patch.scope)).status).toBe('missing');
    });

    it('accepts only the latest memory version visible at the requested position', async () => {
      const { repo, batch, patch } = await scenario();
      await publishMemory(repo, batch.scope, batch.sourceRefs, batch.operationId, batch.events[0]!.eventId, '最初回忆');
      const posting: IndexPosting = { scope: batch.scope, kind: 'keyword', key: '苹果', target: 'memory', targetId: 'memory-fixture', commitSeq: 1, memoryRevision: 1 };
      expect((await repo.publishIndex({ ...patch, memoryRevision: 1, postings: [posting] })).status).toBe('published');
      await publishMemory(repo, batch.scope, batch.sourceRefs, batch.operationId, batch.events[0]!.eventId, '修改回忆', 1);
      expect(await repo.publishIndex({ ...patch, memoryRevision: 2, expectedIndexVersion: 1, postings: [posting] })).toMatchObject({ status: 'conflict', reason: 'invalid_index_target' });
      expect((await repo.publishIndex({ ...patch, memoryRevision: 2, expectedIndexVersion: 1, postings: [{ ...posting, memoryRevision: 2 }] })).status).toBe('published');
    });

    it('a child index cannot include future ancestor or sibling records', async () => {
      const { repo, batch, patch } = await scenario();
      const snapshot = await capture(repo, batch.scope); await repo.publishSnapshot(snapshot, slotFor(snapshot));
      const child = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'child', sessionId: 'session-child' });
      const sibling = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'sibling', sessionId: 'session-sibling' });
      const future = await nextBatch(repo, batch.scope); await prepareBatch(repo, future); await repo.commit(future);
      const sideways = await nextBatch(repo, sibling.scope); await prepareBatch(repo, sideways); await repo.commit(sideways);
      const childPatch = { ...patch, scope: child.scope, sessionId: child.sessionId, postings: [{ ...patch.postings[0]!, scope: child.scope }] };
      for (const targetId of [future.events[0]!.eventId, sideways.events[0]!.eventId]) {
        expect((await repo.publishIndex({ ...childPatch, postings: [{ ...childPatch.postings[0]!, targetId, commitSeq: 2 }] })).status).toBe('conflict');
      }
      expect((await repo.publishIndex(childPatch)).status).toBe('published');
      expect((await repo.readIndexStatus(batch.scope)).status).toBe('missing');
    });

    it('owns the patch synchronously and rejects accessor data without executing it', async () => {
      const { repo, patch } = await scenario(); let reads = 0;
      const unsafe = Object.defineProperty({ ...patch }, 'postings', { enumerable: true, get() { reads++; return patch.postings; } });
      await expect(repo.publishIndex(unsafe)).rejects.toThrow('CORE2_INVALID_INDEXPATCH'); expect(reads).toBe(0);
      const publication = repo.publishIndex(patch); patch.postings[0]!.targetId = 'event-missing';
      expect((await publication).status).toBe('published');
    });
  });
}
