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
  // 三条硬闸（不可放宽）：受保护幼态原著名单、未成年年龄证据、机械 / 非人形对象。
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
  // 放宽：年龄未知（无未成年证据、不在受保护名单、不是机械/非人形）的角色同样放行。
  // 年龄确认字段只作档案展示信息，不再是建档资格条件。
  return { confirmed: true, reason: '未命中未成年证据、受保护名单与非人形闸，按放宽规则放行' };
}
