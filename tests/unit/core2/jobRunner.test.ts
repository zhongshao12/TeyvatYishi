import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertJobRunnerContract } from './jobRunnerContract';
assertJobRunnerContract(async () => createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-jobs-${crypto.randomUUID()}` }));
