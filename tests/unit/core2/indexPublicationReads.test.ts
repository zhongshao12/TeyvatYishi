import { expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore, IDBIndex } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { makeImportFixture } from './importRepositoryContract';
import { eventIndex } from './indexRepositoryContract';
import { makeSeed } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';

it('validates a target once per frozen position, not once for every term in its posting list', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-index-reads-${crypto.randomUUID()}` });
  const { batch } = await makeImportFixture(repo), patch = eventIndex(batch);
  patch.postings = Array.from({ length: 100 }, (_, i) => ({ ...patch.postings[0]!, key: `term-${i}` }));
  const gets = vi.spyOn(IDBObjectStore.prototype, 'get');
  try {
    expect((await repo.publishIndex(patch)).status).toBe('published');
    expect(gets.mock.contexts.filter(store => store instanceof IDBObjectStore && store.name === 'events')).toHaveLength(1);
    const invalid = { ...patch, expectedIndexVersion: 1, postings: [patch.postings[0]!, { ...patch.postings[1]!, commitSeq: 0 }] };
    expect(await repo.publishIndex(invalid)).toMatchObject({ status: 'conflict', reason: 'invalid_index_target' });
    expect((await repo.readIndexStatus(batch.scope)).indexVersion).toBe(1);
  } finally { gets.mockRestore(); }
});

it('seeks within a common term without omitting or repeating targets across page boundaries', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-common-term-${crypto.randomUUID()}` }), seed = makeSeed();
  await repo.initialize(seed); const batch = makeBatch(seed), original = batch.events[0]!;
  batch.events = Array.from({ length: 63 }, (_, i) => ({ ...structuredClone(original), eventId: i === 0 ? original.eventId : `event-target-${String(i).padStart(3, '0')}`, committedChanges: i === 0 ? original.committedChanges : [] }));
  await prepareBatch(repo, batch); expect((await repo.commit(batch)).status).toBe('committed');
  const patch = eventIndex(batch); patch.postings = batch.events.map(event => ({ ...patch.postings[0]!, targetId: event.eventId, key: 'common' }));
  expect((await repo.publishIndex(patch)).status).toBe('published');
  const query = { scope: batch.scope, cutoffSeq: 1, memoryRevision: 0, kind: 'type' as const, keys: ['common', 'common'], limit: 7 };
  const ids: string[] = []; let cursor: string | undefined;
  do { const page = await repo.queryPostings({ ...query, ...(cursor ? { cursor } : {}) }); ids.push(...page.items.map(row => row.targetId)); cursor = page.nextCursor; } while (cursor);
  expect(ids).toEqual(batch.events.map(row => row.eventId)); expect(new Set(ids).size).toBe(63);
});

it('reads only a bounded keyed posting page and preserves the existing cursor order and filters', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-posting-page-${crypto.randomUUID()}` });
  const { batch } = await makeImportFixture(repo), patch = eventIndex(batch);
  const keys = ['引号"词', '换\n行', ...Array.from({ length: 24 }, (_, i) => `term-${String(i).padStart(3, '0')}`)];
  patch.postings = keys.map(key => ({ ...patch.postings[0]!, key })); await repo.publishIndex(patch);
  const allReads = vi.spyOn(IDBIndex.prototype, 'getAll');
  const query = { scope: batch.scope, cutoffSeq: 1, memoryRevision: 0, kind: 'type' as const, keys: [...keys].reverse(), target: 'event' as const, limit: 7 };
  try {
    const first = await repo.queryPostings(query); expect(first.items).toHaveLength(7); expect(first.nextCursor).toBeTruthy();
    expect(allReads.mock.contexts.filter(index => index instanceof IDBIndex && index.objectStore.name === 'postings')).toHaveLength(0);
    const items = [...first.items]; let cursor = first.nextCursor;
    while (cursor) { const page = await repo.queryPostings({ ...query, cursor }); items.push(...page.items); cursor = page.nextCursor; }
    const identity = (row: typeof patch.postings[number]) => JSON.stringify([row.kind, row.key, row.target, row.targetId]);
    expect(items.map(identity)).toEqual([...patch.postings].map(identity).sort());
    expect((await repo.queryPostings({ ...query, target: 'memory' })).items).toEqual([]);
    await expect(repo.queryPostings({ ...query, keys: ['unrelated'], cursor: first.nextCursor })).rejects.toThrow('CORE2_CURSOR_MISMATCH');
    await expect(repo.queryPostings({ ...query, cursor: first.nextCursor!.replace(batch.events[0]!.eventId, 'missing-event') })).rejects.toThrow('CORE2_CURSOR_STALE');
  } finally { allReads.mockRestore(); }
});
