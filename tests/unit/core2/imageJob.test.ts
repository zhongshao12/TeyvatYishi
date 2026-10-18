import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertImageJobContract } from './imageJobContract';
assertImageJobContract(async () => createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-image-jobs-' + crypto.randomUUID() }));
