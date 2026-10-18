import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { makeSeed } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';

vi.mock('@/core/sources/sourceIntegrity', async importOriginal => ({
  ...await importOriginal<typeof import('@/core/sources/sourceIntegrity')>(),
  checksumUtf8: () => 'same-checksum',
}));
it('a checksum collision does not make a cursor valid for different exact filter data', async () => {
  const repo = createIndexedRepository({ databaseName: 'test-core2-cursor-collision', factory: new IDBFactory() });
  const seed = makeSeed(); await repo.initialize(seed); const batch = makeBatch(seed);
  const first = { ...batch.events[0]!, eventId: 'event-A' };
  batch.events = [first, ...['event-B', 'event-C'].map(eventId => ({ ...structuredClone(first), eventId, committedChanges: [] }))];
  batch.knowledge = []; batch.commitments = []; batch.jobs = [];
  await prepareBatch(repo, batch); await repo.commit(batch);
  const query = { scope: batch.scope, cutoffSeq: 1, limit: 1, eventIds: ['event-A', 'event-B'] };
  const page = await repo.queryEvents(query); expect(page.items[0]!.eventId).toBe('event-A');
  await expect(repo.queryEvents({ ...query, eventIds: ['event-A', 'event-C'], cursor: page.nextCursor })).rejects.toThrow('CORE2_CURSOR_MISMATCH');
});
