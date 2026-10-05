import { getAdultAgeEvidenceReason, getNsfwArchiveBlockReason } from '@/utils/nsfwArchivePolicy';
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
  // 2026-10-03：原著成年基线角色不走自由文本词表（详见 getNsfwArchiveBlockReason 的第 3 档），
  // 否则「常年讨伐魔物」这类职责描述会把琴这样的成年人类角色整条挡掉。
  const canonicalAdultBaseline = input.canonicalBaselineAge === 'adult' && Boolean(matchCanonical(input.name));
  for (const name of [input.name, ...(input.aliases ?? [])]) {
    const blocked = getNsfwArchiveBlockReason(undefined, name, input.description ?? '', { canonicalAdultBaseline });
    if (blocked) return { confirmed: false, reason: blocked };
  }
  if (input.ageConfirmation === 'minor_blocked' || input.canonicalBaselineAge === 'minor_blocked') {
    return { confirmed: false, reason: '已标记为非成年角色' };
  }
  if (canonicalAdultBaseline) {
    return { confirmed: true, reason: '原著角色可信成年基线' };
  }
  if (input.ageConfirmation === 'adult' && input.ageSource === 'manual') {
    return { confirmed: true, reason: '玩家明确确认成年' };
  }
  // 放宽：年龄未知（无未成年证据、不在受保护名单、不是机械/非人形）的角色同样放行。
  // 但**「未检出未成年词」不等于可信成年证据**（B09）：只有描述里整词解析出 ≥ 18 的年龄，
  // 才给出「明确成年年龄」的理由；否则理由如实写成年龄未知，不把放宽规则伪装成成年确认。
  const adultAgeEvidence = getAdultAgeEvidenceReason(undefined, input.name, input.description ?? '');
  if (adultAgeEvidence) {
    return { confirmed: true, reason: adultAgeEvidence };
  }
  return { confirmed: true, reason: '未命中未成年证据、受保护名单与非人形闸：年龄未知，按放宽规则放行（不是可信成年证据）' };
}
