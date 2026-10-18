import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertBranchRecoveryRepositoryContract } from './branchRecoveryRepositoryContract';

assertBranchRecoveryRepositoryContract(async () => createIndexedRepository({factory:new IDBFactory(),databaseName:`test-core2-recovery-${crypto.randomUUID()}`}));
