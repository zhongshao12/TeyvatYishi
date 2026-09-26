import type { 游戏设置 } from '@/models/settings';

const RETIRED_TAVERN_PRESET_IDS = new Set([
  'builtin_preset',
  'builtin_shuangrenchenghang_v2',
  'builtin_izumi_v2',
  'builtin_sanrennixing_v2',
]);

export function normalizeRetiredTavernSelection<
  T extends Pick<游戏设置, 'currentStPresetId' | 'currentStPresetIdV2'>,
>(settings: T): T {
  const currentStPresetId = RETIRED_TAVERN_PRESET_IDS.has(settings.currentStPresetId ?? '')
    ? null
    : settings.currentStPresetId;
  const currentStPresetIdV2 = RETIRED_TAVERN_PRESET_IDS.has(settings.currentStPresetIdV2 ?? '')
    ? null
    : settings.currentStPresetIdV2;
  if (currentStPresetId === settings.currentStPresetId && currentStPresetIdV2 === settings.currentStPresetIdV2) return settings;
  return { ...settings, currentStPresetId, currentStPresetIdV2 };
}
