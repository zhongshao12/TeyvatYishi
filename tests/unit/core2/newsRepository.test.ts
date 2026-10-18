import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertNewsRepositoryContract } from './newsRepositoryContract';
assertNewsRepositoryContract(async () => createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-news-repository-${crypto.randomUUID()}` }));
