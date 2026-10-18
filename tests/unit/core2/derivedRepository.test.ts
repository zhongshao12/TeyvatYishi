import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertDerivedRepositoryContract } from './derivedRepositoryContract';

assertDerivedRepositoryContract(async fault => {
  const options = { databaseName: `test-core2-derived-${crypto.randomUUID()}`, factory: new IDBFactory() };
  const repo = createIndexedRepository({ ...options, fault: point => {
    if (point === 'derived:memories' || point === 'derived:receipt') fault?.(point);
  } });
  return { repo, connect: async () => createIndexedRepository(options) };
});
