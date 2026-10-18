import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertSaveSlotsRepositoryContract } from './saveSlotsRepositoryContract';

assertSaveSlotsRepositoryContract(async()=>createIndexedRepository({factory:new IDBFactory(),databaseName:`test-core2-save-slots-${crypto.randomUUID()}`}));
