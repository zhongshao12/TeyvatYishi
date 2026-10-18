import { expect, it, vi } from 'vitest';
import { retrieveCoreMemories } from '@/core/retrieval/retrieveMemory';
import { recallFixture } from './recallFixture';
import { capture, slotFor } from './snapshotRepositoryContract';
import { nextBatch } from './snapshotRepositoryContract';
import { prepareBatch } from './repositoryContract';

it('combines layers and confirmed events, deduplicating event identity rather than equal prose', async () => {
  const f = await recallFixture();
  await f.publish({ memoryId: 'short-apple', layer: 'short' });
  await f.publish({ memoryId: 'long-apple', layer: 'long' });
  await f.publish({ memoryId: 'middle-different', eventIds: [f.batches[2]!.events[0]!.eventId], sourceRefs: f.batches[2]!.sourceRefs, layer: 'middle' });
  const reads = vi.spyOn(f.repo, 'readSource');
  const result = await retrieveCoreMemories(await f.request(), { repo: f.repo });
  expect(result.completeness).toBe('complete'); expect(result.optional.length).toBeLessThanOrEqual(8);
  expect(result.selectedLeafIds.filter(id => id === f.batches[0]!.events[0]!.eventId)).toHaveLength(1);
  expect(result.selectedLeafIds).toContain(f.batches[2]!.events[0]!.eventId);
  expect(result.optional.some(row => row.memoryId === 'middle-different')).toBe(true);
  expect(reads).not.toHaveBeenCalled();
});

it('catches up more than fifty commits and reports failure rather than a complete empty result', async () => {
  const f = await recallFixture(55), input = await f.request();
  const page = vi.spyOn(f.repo, 'queryEvents');
  const result = await retrieveCoreMemories(input, { repo: f.repo });
  expect(result.indexPosition.coreSeq).toBe(55); expect(result.completeness).toBe('complete');
  expect(page.mock.calls.some(([query]) => !!query.cursor)).toBe(true);
  vi.spyOn(f.repo, 'readIndexStatus').mockResolvedValue({ scope: input.scope, status: 'lagging', indexVersion: 0, coreSeq: 0, memoryRevision: 0 });
  vi.spyOn(f.repo, 'publishIndex').mockRejectedValue(Error('quota'));
  await expect(retrieveCoreMemories(input, { repo: f.repo })).rejects.toThrow('CORE2_INDEX_UNAVAILABLE');
});

it('bounds inherited retrieval at fork positions and refuses stale positions, including memory-only drift', async () => {
  const f = await recallFixture(1), snapshot = await capture(f.repo, f.seed.head.scope);
  await f.repo.publishSnapshot(snapshot, slotFor(snapshot));
  const child = await f.repo.fork({ snapshotId: snapshot.snapshotId, parentScope: snapshot.scope, branchId: 'recall-child', sessionId: 'recall-child-session' });
  const later = await nextBatch(f.repo, f.seed.head.scope); await prepareBatch(f.repo, later); await f.repo.commit(later);
  const childRequest = { ...await f.request(), scope: child.scope, head: child };
  const result = await retrieveCoreMemories(childRequest, { repo: f.repo });
  expect(result.selectedLeafIds).toEqual([f.batches[0]!.events[0]!.eventId]);
  const inherited = await retrieveCoreMemories({ ...childRequest, audience: { target: 'private', npcIds: ['npc-amber'] } }, { repo: f.repo });
  expect(inherited.selectedLeafIds).toEqual(result.selectedLeafIds);
  const old = await f.request(); await f.publish({});
  await expect(retrieveCoreMemories(old, { repo: f.repo })).rejects.toThrow('CORE2_RECALL_POSITION_CHANGED');
});

it('keeps a maximum eight optional items and rejects cancelled or concurrently advanced requests', async () => {
  const f = await recallFixture(12), request = await f.request();
  expect((await retrieveCoreMemories(request, { repo: f.repo })).optional).toHaveLength(8);
  const stop = new AbortController(); stop.abort();
  await expect(retrieveCoreMemories({ ...request, signal: stop.signal }, { repo: f.repo })).rejects.toThrow('CORE2_RECALL_CANCELLED');
  const query = f.repo.queryKnowledge.bind(f.repo);
  vi.spyOn(f.repo, 'queryKnowledge').mockImplementation(async input => {
    const result = await query(input); await f.repo.activateSession(request.scope, 'other-tab'); return result;
  });
  await expect(retrieveCoreMemories({ ...request, audience: { target: 'private', npcIds: ['npc-amber'] } }, { repo: f.repo })).rejects.toThrow('CORE2_RECALL_POSITION_CHANGED');
});

it('finds protected memories through a versioned candidate index without loading every active summary', async () => {
  const f = await recallFixture(1); await f.publish({ memoryId: 'protected-unrelated', pinned: true, npcIds: ['npc-unrelated'], locations: ['其它地点'], text: '不能遗漏的承诺。' });
  const head = await f.repo.readHead(f.seed.head.scope);
  // A previous-format cache can match positions yet omit protected-memory postings.
  await f.repo.publishIndex({ scope: head.scope, sessionId: head.sessionId, cutoffSeq: head.coreSeq, memoryRevision: head.memoryRevision, expectedIndexVersion: 0, postings: [] });
  const query = vi.spyOn(f.repo, 'queryMemories');
  const result = await retrieveCoreMemories(await f.request(), { repo: f.repo });
  expect(result.mandatory.some(row => row.memoryId === 'protected-unrelated')).toBe(true);
  expect(query.mock.calls.every(([request]) => request.memoryIds !== undefined)).toBe(true);
});
