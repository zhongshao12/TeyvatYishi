import { getNsfwArchiveBlockReason } from '@/utils/nsfwArchivePolicy';
import { matchCanonical } from '@/data/canonicalCharacters';

export type NpcAdultAgeSource = 'canonical' | 'manual' | 'legacy_unverified';
export type NpcAdultAgeConfirmation = 'adult' | 'unknown' | 'minor_blocked';

export interface NpcAdultEligibilityInput {
  name: string;
  aliases?: readonly string[];
  description?: string;
  ageConfirmation?: NpcAdultAgeConfirmation;
  ageSource?: NpcAdultAgeSource;
  canonicalBaselineAge?: NpcAdultAgeConfirmation;
}

export function resolveNpcAdultEligibility(input: NpcAdultEligibilityInput): { confirmed: boolean; reason: string } {
  for (const name of [input.name, ...(input.aliases ?? [])]) {
    const blocked = getNsfwArchiveBlockReason(undefined, name, input.description ?? '');
    if (blocked) return { confirmed: false, reason: blocked };
  }
  if (input.ageConfirmation === 'minor_blocked' || input.canonicalBaselineAge === 'minor_blocked') {
    return { confirmed: false, reason: '已标记为非成年角色' };
  }
  if (input.canonicalBaselineAge === 'adult' && matchCanonical(input.name)) {
    return { confirmed: true, reason: '原著角色可信成年基线' };
  }
  if (input.ageConfirmation === 'adult' && input.ageSource === 'manual') {
    return { confirmed: true, reason: '玩家明确确认成年' };
  }
  return { confirmed: false, reason: '缺少独立、可信的成年确认' };
}
