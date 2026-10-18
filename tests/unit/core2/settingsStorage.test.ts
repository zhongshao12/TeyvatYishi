import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as existing from '@/core/view/existingSettings';

it('keeps Core2 configuration saves separate from all legacy save stores and survives reopening', async () => {
  expect(typeof existing.createCoreSettingsStorage).toBe('function');
  const factory = new IDBFactory(), storage = existing.createCoreSettingsStorage({ factory });
  expect(await storage.loadSetting('apiSettings')).toBeNull();
  expect(await factory.databases()).toEqual([]);
  await storage.saveSettings({ apiSettings: { configs: [{ id: 'local', model: 'test-only', apiKey: 'not-a-real-key' }] }, gameSettings: { enableStPreset: true } });
  const reopened = existing.createCoreSettingsStorage({ factory });
  expect(await reopened.loadSetting('apiSettings')).toEqual({ configs: [{ id: 'local', model: 'test-only', apiKey: 'not-a-real-key' }] });
  expect(await reopened.loadSetting('gameSettings')).toEqual({ enableStPreset: true });
  expect((await factory.databases()).map(row => row.name)).toEqual(['TeyvatCore2SettingsDB']);
  await expect(storage.saveSetting('worldState', { time: 'corrupt old world' })).rejects.toThrow('CORE2_SETTINGS_KEY');
});

it('serializes desktop settings writes across instances and reports a failed atomic save without losing the previous value', async () => {
  let file: Record<string, unknown> | null = null;
  const adapter = { readJson: async <T,>() => structuredClone(file) as T | null, writeJson: vi.fn(async (_path: string, value: unknown) => { file = structuredClone(value) as Record<string, unknown>; }) };
  const a = existing.createCoreSettingsStorage({ desktop: adapter }), b = existing.createCoreSettingsStorage({ desktop: adapter });
  await Promise.all([a.saveSetting('gameSettings', { enabled: true }), b.saveSetting('apiSettings', { model: 'saved-model' })]);
  expect(file).toEqual({ gameSettings: { enabled: true }, apiSettings: { model: 'saved-model' } });
  adapter.writeJson.mockRejectedValueOnce(Error('TEST_DISK_FULL'));
  await expect(a.saveSetting('gameSettings', { enabled: false })).rejects.toThrow('TEST_DISK_FULL');
  expect(await b.loadSetting('gameSettings')).toEqual({ enabled: true });
  expect(adapter.writeJson.mock.calls.every(([path]) => path === 'core2-config/runtime-settings.json')).toBe(true);
  await b.saveSetting('worldbooks', []); expect(await a.loadSetting('worldbooks')).toEqual([]);
});
