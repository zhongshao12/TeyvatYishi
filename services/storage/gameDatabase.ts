import { bindIndexedDbConnectionLifecycle } from '@/services/storage/indexedDbConnectionLifecycle';

export const GAME_DB_NAME = 'TimeJourneyDB';
export const GAME_DB_VERSION = 5;
export const SAVES_STORE = 'saves';
export const SAVE_SUMMARIES_STORE = 'saveSummaries';
export const SAVE_ASSETS_STORE = 'saveAssets';
export const SAVE_NODE_DELTAS_STORE = 'saveNodeDeltas';
export const SETTINGS_STORE = 'settings';

let dbPromise: Promise<IDBDatabase> | null = null;
let activeDb: IDBDatabase | null = null;

export function openGameDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (db: IDBDatabase) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      activeDb = db;
      bindIndexedDbConnectionLifecycle(db, () => {
        if (activeDb !== db) return;
        activeDb = null;
        dbPromise = null;
      });
      resolve(db);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeoutId);
      dbPromise = null;
      reject(error);
    };
    const timeoutId = globalThis.setTimeout(() => {
      fail(new Error('存档数据库打开超时。请关闭其他旅行者纪事页面或刷新后重试。'));
    }, 8000);
    const request = indexedDB.open(GAME_DB_NAME, GAME_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SAVES_STORE)) db.createObjectStore(SAVES_STORE, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains(SAVE_SUMMARIES_STORE)) db.createObjectStore(SAVE_SUMMARIES_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SAVE_ASSETS_STORE)) db.createObjectStore(SAVE_ASSETS_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SAVE_NODE_DELTAS_STORE)) db.createObjectStore(SAVE_NODE_DELTAS_STORE, { keyPath: 'nodeId' });
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => finish(request.result);
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new Error('存档数据库升级被其他页面占用。请关闭其他旅行者纪事页面或刷新后重试。'));
  });
  return dbPromise;
}
