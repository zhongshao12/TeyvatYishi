import { GAME_DB_NAME, SETTINGS_STORE } from '@/services/storage/gameDatabase';
import { restoreSettingForRuntime } from '@/services/storage/sensitiveSettings';
import { loadSettingFromDesktopMirror } from '@/services/desktop/desktopSettingsMirror';
import { isDesktopRuntime } from '@/utils/platform/desktopRuntime';
import type { CoreSettingsKey } from './settingsStorage';
export { createCoreSettingsStorage } from './settingsStorage';

/** Read settings only: no upgrade, secret rewrite, game initialization or save migration. */
export async function readExistingCore2Setting<T>(key: CoreSettingsKey, factory: IDBFactory = globalThis.indexedDB): Promise<T | null> {
  if (isDesktopRuntime()) {
    const value = await loadSettingFromDesktopMirror<T>(key);
    if (value !== null) return restoreSettingForRuntime(key, value) as T;
  }
  if (!factory) return null;
  if (factory.databases && !(await factory.databases()).some(db => db.name === GAME_DB_NAME)) return null;
  return new Promise((resolve, reject) => {
    const request = factory.open(GAME_DB_NAME); let missing = false;
    request.onupgradeneeded = () => { missing = true; request.transaction?.abort(); };
    request.onerror = () => missing ? resolve(null) : reject(request.error);
    request.onblocked = () => reject(Error('设置数据库被其它页面占用，请关闭其它页面后重试。'));
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) { db.close(); resolve(null); return; }
      const tx = db.transaction(SETTINGS_STORE, 'readonly'), read = tx.objectStore(SETTINGS_STORE).get(key);
      tx.oncomplete = () => { db.close(); resolve(read.result ? restoreSettingForRuntime(key, read.result.value) as T : null); };
      tx.onabort = () => { db.close(); reject(tx.error ?? Error('读取设置失败。')); };
    };
  });
}
