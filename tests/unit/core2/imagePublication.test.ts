import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertImagePublicationContract } from './imagePublicationContract';
assertImagePublicationContract(async () => createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-image-publication-${crypto.randomUUID()}` }));
