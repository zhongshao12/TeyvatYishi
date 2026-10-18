import { isCoreJsonData } from '../contracts/validation';
import { createAppStorageAdapter, type AppStorageAdapter } from '@/services/storage/appStorageAdapter';
import { isDesktopRuntime } from '@/utils/platform/desktopRuntime';
import { prepareSettingForPersistence, restoreSettingForRuntime } from '@/services/storage/sensitiveSettings';

export const CORE_SETTINGS_KEYS = ['apiSettings', 'gameSettings', 'apiProfileSlots', 'apiAuxProfileStates', 'worldbooks', 'imagePromptLibrary'] as const;
export type CoreSettingsKey = typeof CORE_SETTINGS_KEYS[number];
export interface CoreSettingsStorage {
  loadSetting<T>(key: string): Promise<T | null>;
  saveSetting(key: string, value: unknown): Promise<void>;
  saveSettings(values: Record<string, unknown>): Promise<void>;
}
const filename = 'core2-config/runtime-settings.json';
// One application-wide queue covers the desktop file's whole read/modify/write,
// including writes through a second settings page/store instance.
let desktopQueue: Promise<unknown> = Promise.resolve();
function allowed(key: string): asserts key is CoreSettingsKey {
  if (!(CORE_SETTINGS_KEYS as readonly string[]).includes(key)) throw Error('CORE2_SETTINGS_KEY');
}
function ownValues(value: unknown): Record<string, unknown> {
  if (!isCoreJsonData(value) || !value || typeof value !== 'object' || Array.isArray(value)) throw Error('CORE2_SETTINGS_FORMAT');
  for (const key of Object.keys(value)) allowed(key);
  return structuredClone(value) as Record<string, unknown>;
}
/** Settings only. This database/file never contains a game save, event or memory. */
export function createCoreSettingsStorage(options: { factory?: IDBFactory; desktop?: Pick<AppStorageAdapter, 'readJson' | 'writeJson'> | false } = {}): CoreSettingsStorage {
  const desktop = options.desktop === false ? undefined : options.desktop ?? (isDesktopRuntime() ? createAppStorageAdapter() : undefined);
  const factory = options.factory ?? globalThis.indexedDB;
  const database = async (write: boolean): Promise<IDBDatabase | null> => {
    if (!factory) throw Error('CORE2_SETTINGS_UNAVAILABLE');
    if (!write && factory.databases && !(await factory.databases()).some(row => row.name === 'TeyvatCore2SettingsDB')) return null;
    return new Promise((resolve, reject) => {
      const open = factory.open('TeyvatCore2SettingsDB', 1); let missing = false;
      open.onupgradeneeded = () => {
        if (!write) { missing = true; open.transaction?.abort(); return; }
        open.result.createObjectStore('settings', { keyPath: 'key' });
      };
      open.onerror = () => missing ? resolve(null) : reject(open.error);
      open.onblocked = () => reject(Error('设置库被其它页面占用，请关闭其它页面后重试。'));
      open.onsuccess = () => {
        if (!open.result.objectStoreNames.contains('settings')) { open.result.close(); reject(Error('CORE2_SETTINGS_FORMAT')); }
        else resolve(open.result);
      };
    });
  };
  const storage: CoreSettingsStorage = {
    async loadSetting<T>(key: string) {
      allowed(key);
      if (desktop) {
        const saved = await desktop.readJson<Record<string, unknown>>(filename);
        const values = saved === null ? {} : ownValues(saved);
        return key in values ? restoreSettingForRuntime(key, structuredClone(values[key])) as T : null;
      }
      const db = await database(false); if (!db) return null;
      return new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction('settings', 'readonly'), read = tx.objectStore('settings').get(key);
        tx.oncomplete = () => { db.close(); resolve(read.result ? restoreSettingForRuntime(key, read.result.value) as T : null); };
        tx.onabort = () => { db.close(); reject(tx.error ?? Error('设置读取失败。')); };
      });
    },
    saveSetting: (key, value) => storage.saveSettings({ [key]: value }),
    async saveSettings(input) {
      const values = ownValues(input);
      for (const key of Object.keys(values)) values[key] = prepareSettingForPersistence(key, values[key]);
      if (desktop) {
        const write = async () => {
          const previous = await desktop.readJson<Record<string, unknown>>(filename);
          await desktop.writeJson(filename, { ...(previous === null ? {} : ownValues(previous)), ...values });
        };
        const next = desktopQueue.then(write, write); desktopQueue = next.catch(() => undefined); await next; return;
      }
      const db = await database(true); if (!db) throw Error('CORE2_SETTINGS_UNAVAILABLE');
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('settings', 'readwrite');
        for (const [key, value] of Object.entries(values)) tx.objectStore('settings').put({ key, value });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error ?? Error('设置保存失败。')); };
      });
    },
  };
  return storage;
}
