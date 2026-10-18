import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertPhonePhotoContextContract } from './phonePhotoContextContract';
assertPhonePhotoContextContract(async () => createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-phone-photo-' + crypto.randomUUID() }));
