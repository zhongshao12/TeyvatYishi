import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertSourceQueryRepositoryContract } from './sourceQueryRepositoryContract';

assertSourceQueryRepositoryContract(async () => createIndexedRepository({
  databaseName: `test-core2-source-query-${crypto.randomUUID()}`, factory: new IDBFactory(),
}));
