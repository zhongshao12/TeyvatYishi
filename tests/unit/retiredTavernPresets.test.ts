import { describe, expect, it } from 'vitest';
import { 创建默认游戏设置 } from '@/models/settings';
import { normalizeRetiredTavernSelection } from '@/utils/retiredTavernPresets';

const retiredIds = [
  'builtin_preset',
  'builtin_shuangrenchenghang_v2',
  'builtin_izumi_v2',
  'builtin_sanrennixing_v2',
] as const;

describe('retired Tavern preset selection', () => {
  it('starts without a bundled Tavern preset selected', () => {
    const defaults = 创建默认游戏设置();
    expect(defaults.currentStPresetId).toBeNull();
    expect(defaults.currentStPresetIdV2).toBeNull();
  });

  it.each(retiredIds)('clears retired selection %s without touching imported presets', (id) => {
    const imported = [{ id: 'my_preset', name: '双人成行v10.0—青云上' }];
    const source = {
      currentStPresetId: id,
      currentStPresetIdV2: id,
      stPresetsV2: imported,
      enableStPreset: true,
    };
    const next = normalizeRetiredTavernSelection(source);
    expect(next.currentStPresetId).toBeNull();
    expect(next.currentStPresetIdV2).toBeNull();
    expect(next.stPresetsV2).toBe(imported);
    expect(next.enableStPreset).toBe(true);
    expect(source.currentStPresetId).toBe(id);
  });

  it('preserves a selected imported preset and an absent selection', () => {
    const selected = normalizeRetiredTavernSelection({
      currentStPresetId: null,
      currentStPresetIdV2: 'my_preset',
    });
    expect(selected.currentStPresetIdV2).toBe('my_preset');

    const absent = normalizeRetiredTavernSelection({
      currentStPresetId: undefined,
      currentStPresetIdV2: null,
    });
    expect(absent.currentStPresetId).toBeUndefined();
    expect(absent.currentStPresetIdV2).toBeNull();
  });

});
