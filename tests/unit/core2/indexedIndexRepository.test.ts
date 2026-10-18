import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { openCoreDatabase } from '@/core/persistence/indexedSchema';
import { assertIndexRepositoryContract, eventIndex } from './indexRepositoryContract';
import { makeSeed } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';

const factory = new IDBFactory(), databaseName = `test-core2-index-${crypto.randomUUID()}`;
assertIndexRepositoryContract(async () => createIndexedRepository({ factory, databaseName }));

describe('atomic posting replacement', () => {
  for (const point of ['index:postings', 'index:meta'] as const) {
    it(`a failure at ${point} preserves the previous complete index`, async () => {
      const factory = new IDBFactory(), databaseName = `test-core2-index-fault-${crypto.randomUUID()}`;
      let enabled = false;
      const repo = createIndexedRepository({ factory, databaseName, fault: current => { if (enabled && current === point) throw new Error('injected-index'); } });
      const seed = makeSeed(); await repo.initialize(seed);
      const batch = makeBatch(seed); await prepareBatch(repo, batch); await repo.commit(batch);
      expect(typeof repo.publishIndex).toBe('function');
      const patch = eventIndex(batch); await repo.publishIndex(patch); enabled = true;
      await expect(repo.publishIndex({ ...patch, expectedIndexVersion: 1, postings: [] })).rejects.toThrow('injected-index');
      const reopened = createIndexedRepository({ factory, databaseName });
      expect(await reopened.readIndexStatus(batch.scope)).toMatchObject({ indexVersion: 1, status: 'ready' });
      const db = await openCoreDatabase(databaseName, factory);
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const req = db.transaction('postings').objectStore('postings').getAll(); req.onsuccess = () => resolve(req.result as unknown[]); req.onerror = () => reject(req.error);
      });
      db.close(); expect(rows).toEqual(patch.postings);
    });
  }
});
