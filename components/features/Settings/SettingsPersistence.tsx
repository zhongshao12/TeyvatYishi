import { createContext, useContext } from 'react';
import { loadSetting, saveSetting, saveSettings } from '@/services/storage/indexedSettingsStore';

export interface SettingsPersistence {
  loadSetting<T>(key: string): Promise<T | null>;
  saveSetting(key: string, value: unknown): Promise<void>;
  saveSettings(values: Record<string, unknown>): Promise<void>;
}
/** Shared editors receive a settings-only port; they never need a game writer. */
const SettingsPersistenceContext = createContext<SettingsPersistence>({ loadSetting, saveSetting, saveSettings });
export const SettingsPersistenceProvider = SettingsPersistenceContext.Provider;
export function useSettingsPersistence(): SettingsPersistence { return useContext(SettingsPersistenceContext); }
