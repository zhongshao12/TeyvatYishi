import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertCommitmentDateRepositoryContract } from './commitmentDateRepositoryContract';

assertCommitmentDateRepositoryContract(async () => createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-due-${crypto.randomUUID()}` }));
