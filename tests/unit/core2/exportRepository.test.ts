import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertExportRepositoryContract } from './exportRepositoryContract';
assertExportRepositoryContract(async()=>createIndexedRepository({factory:new IDBFactory(),databaseName:`test-core2-export-${crypto.randomUUID()}`}));
