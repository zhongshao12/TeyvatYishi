import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertJourneyDirectoryContract } from './journeyDirectoryContract';
assertJourneyDirectoryContract(async () => createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-journey-directory-${crypto.randomUUID()}` }));
