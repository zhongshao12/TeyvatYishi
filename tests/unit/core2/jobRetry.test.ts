import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertJobRetryContract } from './jobRetryContract';
assertJobRetryContract(async () => createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-job-retry-${crypto.randomUUID()}` }));
