import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertRuntimeRepositoryContract } from './runtimeRepositoryContract';
assertRuntimeRepositoryContract(async () => createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-runtime-repository-${crypto.randomUUID()}` }));
