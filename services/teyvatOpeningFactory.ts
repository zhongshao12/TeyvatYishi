import { getOfficialOpeningPreset } from '@/models/teyvat/opening';
import {
  createEmptyTeyvatGameState,
  normalizeTeyvatGameState,
  type TeyvatGameState,
} from '@/models/teyvat/state';

export function createTeyvatGameFromOpeningPreset(presetId: string): TeyvatGameState {
  const preset = getOfficialOpeningPreset(presetId);
  if (!preset) throw new Error('UNKNOWN_OPENING_PRESET');

  const base = createEmptyTeyvatGameState();
  return normalizeTeyvatGameState({
    ...base,
    旅行者: {
      ...base.旅行者,
      身份: preset.identitySeed.身份,
    },
    世界: {
      ...base.世界,
      当前地区: preset.regionId,
      当前地点: preset.location,
    },
  });
}
