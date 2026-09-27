import { openGameDatabase, SAVE_ASSETS_STORE, SAVE_NODE_DELTAS_STORE } from './gameDatabase';
import type { SaveAssetRecord } from '@/utils/saveAssetStorage';
import type { SaveNodeDeltaRecord } from '@/utils/saveDeltaStorage';
import { summarizeStorageAttribution, type StorageAttribution } from '@/utils/storageAttribution';

function scanStore<T>(db: IDBDatabase, name: string, read: (value: T) => void): Promise<void> {
  if (!db.objectStoreNames.contains(name)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readonly');
    const request = tx.objectStore(name).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      read(cursor.value as T);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** User-triggered metadata scan. Image payloads never leave this function. */
export async function scanStorageAttribution(saves: ReadonlyArray<{ id: number; sizeBytes: number }>): Promise<StorageAttribution> {
  const db = await openGameDatabase();
  const assets: Array<{ id: string; bytes: number }> = [];
  const deltas: Array<{ saveId: number; baseMode: 'checkpoint' | 'delta'; assetIds: string[] }> = [];
  await scanStore<SaveAssetRecord>(db, SAVE_ASSETS_STORE, (record) => {
    const dataLength = record.dataUrl?.length ?? 0;
    assets.push({ id: record.id, bytes: record.blob?.size ?? record.size ?? (dataLength ? Math.floor(dataLength * 0.75) : 0) });
  });
  await scanStore<SaveNodeDeltaRecord>(db, SAVE_NODE_DELTAS_STORE, (record) => {
    deltas.push({ saveId: record.saveId, baseMode: record.baseMode, assetIds: record.assetIds });
  });
  return summarizeStorageAttribution(saves, assets, deltas);
}
