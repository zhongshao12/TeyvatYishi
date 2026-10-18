import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertRepositoryContract } from './repositoryContract';
import { assertJobCommitGuardContract } from './jobCommitGuardContract';

assertJobCommitGuardContract(async () => createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-commit-guard-${crypto.randomUUID()}` }));

assertRepositoryContract(async () => {
  const factory = new IDBFactory();
  const databaseName = `test-core2-contract-${crypto.randomUUID()}`;
  const options = { databaseName, factory };
  return { repo: createIndexedRepository(options), connect: async () => createIndexedRepository(options) };
});
