import {
  loadSettingFromDesktopMirror,
  mirrorSettingsToDesktop,
  removeSettingFromDesktopMirror,
} from '@/services/desktop/desktopSettingsMirror';
import { isDesktopRuntime } from '@/utils/platform/desktopRuntime';
import {
  clearSessionSecretForSetting,
  hasPersistentSensitiveValue,
  prepareSettingForPersistence,
  restoreSettingForRuntime,
} from '@/services/storage/sensitiveSettings';
import { openGameDatabase, SETTINGS_STORE } from '@/services/storage/gameDatabase';

export async function saveSetting(key: string, value: unknown): Promise<void> {
  await saveSettings({ [key]: value });
}

export async function saveSettings(settings: Record<string, unknown>): Promise<void> {
  const persistentSettings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    persistentSettings[key] = prepareSettingForPersistence(key, value);
  }
  if (isDesktopRuntime()) {
    await mirrorSettingsToDesktop(persistentSettings);
    await cacheIndexedSettingsSafely(persistentSettings);
    return;
  }
  await writeIndexedSettings(persistentSettings);
}

export async function loadSetting<T>(key: string): Promise<T | null> {
  const desktopValue = await loadDesktopSettingFirstSafely<T>(key);
  if (desktopValue !== null) return hydrateLoadedSetting(key, desktopValue);
  const db = await openGameDatabase();
  const indexedValue = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readonly');
    const store = tx.objectStore(SETTINGS_STORE);
    const request = store.get(key);
    request.onsuccess = () => {
      const result = request.result;
      resolve(result ? (result.value as T) : null);
    };
    request.onerror = () => reject(request.error);
  });
  if (indexedValue !== null) return hydrateLoadedSetting(key, indexedValue);
  const fallbackValue = await loadDesktopSettingFallbackSafely<T>(key);
  return fallbackValue === null ? null : hydrateLoadedSetting(key, fallbackValue);
}

export async function deleteSetting(key: string): Promise<void> {
  clearSessionSecretForSetting(key);
  if (isDesktopRuntime()) {
    await removeSettingFromDesktopMirror(key);
    await deleteIndexedSettingSafely(key);
    return;
  }
  await deleteIndexedSetting(key);
}

async function hydrateLoadedSetting<T>(key: string, value: T): Promise<T> {
  const containedPlaintextSecret = hasPersistentSensitiveValue(key, value);
  const runtimeValue = restoreSettingForRuntime(key, value);
  if (containedPlaintextSecret) await saveSetting(key, runtimeValue);
  return runtimeValue;
}

async function writeIndexedSettings(settings: Record<string, unknown>): Promise<void> {
  const db = await openGameDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE);
    for (const [key, value] of Object.entries(settings)) store.put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB settings transaction aborted'));
  });
}

async function cacheIndexedSettingsSafely(settings: Record<string, unknown>): Promise<void> {
  try {
    await writeIndexedSettings(settings);
  } catch (error) {
    console.warn('[desktop-settings-mirror] IndexedDB settings cache write failed', error);
  }
}

async function loadDesktopSettingFirstSafely<T>(key: string): Promise<T | null> {
  try {
    return await loadSettingFromDesktopMirror<T>(key);
  } catch (error) {
    console.warn('[desktop-settings-mirror] setting priority load failed', error);
    return null;
  }
}

async function loadDesktopSettingFallbackSafely<T>(key: string): Promise<T | null> {
  try {
    return await loadSettingFromDesktopMirror<T>(key);
  } catch (error) {
    console.warn('[desktop-settings-mirror] setting mirror load failed', error);
    return null;
  }
}

async function deleteIndexedSetting(key: string): Promise<void> {
  const db = await openGameDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteIndexedSettingSafely(key: string): Promise<void> {
  try {
    await deleteIndexedSetting(key);
  } catch (error) {
    console.warn('[desktop-settings-mirror] IndexedDB setting cache delete failed', error);
  }
}
