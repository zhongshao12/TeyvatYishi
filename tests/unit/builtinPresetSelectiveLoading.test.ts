import { afterEach, describe, expect, it, vi } from 'vitest';
import * as builtinPresets from '@/data/builtinPresets';

describe('selected built-in Tavern preset loading', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not fetch unused presets and loads only the selected built-in preset', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (input: string) => {
      requested.push(input);
      return { ok: true, json: async () => ({ prompts: [{ identifier: 'main', role: 'system', content: 'test' }], prompt_order: [] }) };
    });
    const loadSelected = builtinPresets.loadSelectedBuiltinTavernPreset;

    expect(await loadSelected(null, true)).toBe(false);
    expect(await loadSelected('custom-player-preset', true)).toBe(false);
    expect(await loadSelected(builtinPresets.BUILTIN_SHUANGRENCHENGHANG_PRESET_ID, false)).toBe(false);
    expect(requested).toEqual([]);

    expect(await loadSelected(builtinPresets.BUILTIN_SHUANGRENCHENGHANG_PRESET_ID, true)).toBe(true);
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain('builtin_shuangrenchenghang_v2.json');
    expect(builtinPresets.isBuiltinTavernPresetLoaded(builtinPresets.BUILTIN_SHUANGRENCHENGHANG_PRESET_ID)).toBe(true);
  });
});
