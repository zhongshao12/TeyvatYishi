import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertStoryContentContract } from './storyContentContract';
assertStoryContentContract(async () => createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-story-content-${crypto.randomUUID()}` }));
