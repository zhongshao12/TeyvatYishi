import type { CoreRepository } from '../contracts/storage';
import type { CoreDesktopTransport } from './desktopProtocol';
import { createIndexedRepository } from './indexedRepository';
import { createDesktopRepository } from './desktopRepository';
import { createTauriCoreTransport } from './tauriTransport';
export interface RepositoryOptions {webFactory?:IDBFactory;desktopTransport?:CoreDesktopTransport}
/** One primary backend, selected once. No error-driven fallback or legacy load. */
export async function createCoreRepository(runtime:'web'|'desktop',options:RepositoryOptions={}):Promise<CoreRepository> {
  if(!Object.keys(options).every(key=>['webFactory','desktopTransport'].includes(key))) throw new Error('CORE2_INVALID_REPOSITORY_OPTIONS');
  if(runtime==='desktop') return createDesktopRepository(options.desktopTransport??createTauriCoreTransport());
  if(runtime!=='web') throw new Error('CORE2_INVALID_RUNTIME');
  const factory=options.webFactory??globalThis.indexedDB;
  if(!factory) throw new Error('CORE2_INDEXEDDB_UNAVAILABLE');
  return createIndexedRepository({factory});
}
export async function createTestCoreRepository(options:{factory:IDBFactory;databaseName:string}):Promise<CoreRepository> {
  if(!options.databaseName.startsWith('test-core2-')) throw new Error('CORE2_TEST_NAMESPACE_REQUIRED');
  return createIndexedRepository(options);
}
