import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deleteSetting, loadSetting, saveSetting, saveSettings } from '@/services/storage/indexedSettingsStore';

describe('indexed settings store boundary', () => {
  it('round-trips batched settings and deletes one key', async () => {
    const firstKey = `test.settings.${crypto.randomUUID()}`;
    const secondKey = `test.settings.${crypto.randomUUID()}`;

    await saveSettings({ [firstKey]: { region: 'mondstadt' }, [secondKey]: 7 });
    expect(await loadSetting(firstKey)).toEqual({ region: 'mondstadt' });
    expect(await loadSetting(secondKey)).toBe(7);

    await deleteSetting(firstKey);
    expect(await loadSetting(firstKey)).toBeNull();
    expect(await loadSetting(secondKey)).toBe(7);
  });

  it('keeps the single-setting facade', async () => {
    const key = `test.setting.${crypto.randomUUID()}`;
    await saveSetting(key, '璃月');
    expect(await loadSetting(key)).toBe('璃月');
  });
});
