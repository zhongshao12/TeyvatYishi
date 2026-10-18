import {IDBFactory} from 'fake-indexeddb';
import {createIndexedRepository} from '@/core/persistence/indexedRepository';
import {assertIndexMaintenanceContract} from './indexMaintenanceContract';
assertIndexMaintenanceContract(async()=>createIndexedRepository({factory:new IDBFactory(),databaseName:`test-core2-index-build-${crypto.randomUUID()}`}));
