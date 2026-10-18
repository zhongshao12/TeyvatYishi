import { expect, it, vi } from 'vitest';
import { IDBFactory, IDBIndex } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { makeImportFixture } from './importRepositoryContract';

it('reads exact candidate event IDs without deserializing every event in the branch', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-event-reads-${crypto.randomUUID()}` });
  const { batch } = await makeImportFixture(repo), reads = vi.spyOn(IDBIndex.prototype, 'getAll');
  const query = { scope: batch.scope, cutoffSeq: 1, eventIds: [batch.events[0]!.eventId, batch.events[0]!.eventId, 'missing-event'] };
  try {
    expect((await repo.queryEvents(query)).items.map(row => row.eventId)).toEqual([batch.events[0]!.eventId]);
    expect(reads.mock.contexts.filter(index => index instanceof IDBIndex && index.objectStore.name === 'events')).toHaveLength(0);
    expect((await repo.queryEvents({ ...query, cutoffSeq: 0 })).items).toEqual([]);
    expect((await repo.queryEvents({ ...query, afterSeq: 1 })).items).toEqual([]);
    expect((await repo.queryEvents({ ...query, eventIds: [] })).items).toEqual([]);
  } finally { reads.mockRestore(); }
});
