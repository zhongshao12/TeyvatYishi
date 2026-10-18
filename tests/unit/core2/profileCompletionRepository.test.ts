import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertProfileCompletionContract } from './profileCompletionContract';
assertProfileCompletionContract(async () => createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-profile-${crypto.randomUUID()}` }));
