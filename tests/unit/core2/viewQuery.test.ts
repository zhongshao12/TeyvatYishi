import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertViewQueryContract } from './viewQueryContract';
assertViewQueryContract(async () => createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-views-${crypto.randomUUID()}` }));
