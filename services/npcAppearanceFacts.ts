import type { NPC外貌档案, NPC外貌字段, NPC记录 } from '@/models/npc';
import { resolveNpcAdultEligibility } from '@/utils/npcAdultEligibility';
import { getCanonicalArchiveBaselineAge } from '@/utils/npcArchiveEnrichment';

export const NPC_APPEARANCE_KEYS = ['发色', '瞳色', '身高', '体重', '三围'] as const;
export type NpcAppearanceKey = typeof NPC_APPEARANCE_KEYS[number];

const SOURCE_LABELS: Record<NPC外貌字段['source'], string> = {
  canon: '原著资料', manual: '手动记录', narrative: '正文明确', ai_estimate: 'AI 推测',
};

export function npcAppearanceSourceLabel(source: NPC外貌字段['source']): string {
  return SOURCE_LABELS[source];
}

export function canRevealNpcMeasurements(input: {
  name: string; aliases?: readonly string[]; gender?: string; description?: string;
  ageConfirmation?: 'adult' | 'unknown' | 'minor_blocked';
  ageSource?: 'canonical' | 'manual' | 'legacy_unverified';
}): boolean {
  if (input.gender !== '女') return false;
  // 三围不属于本次放宽范围：仍要求「可验证的成年」——原著成年基线，或玩家手动确认成年；
  // 未确认年龄的角色不展示三围。硬闸（未成年证据 / 受保护名单 / 非人形）也必须通过。
  const provenAdult = getCanonicalArchiveBaselineAge(input.name) === 'adult'
    || (input.ageConfirmation === 'adult' && input.ageSource === 'manual');
  if (!provenAdult) return false;
  return resolveNpcAdultEligibility({
    name: input.name, aliases: input.aliases, description: input.description,
    ageConfirmation: input.ageConfirmation, ageSource: input.ageSource,
    canonicalBaselineAge: getCanonicalArchiveBaselineAge(input.name),
  }).confirmed;
}

/**
 * NSFW 档案私密字段（常用内衣 / 是否处女 / 首次性行为对象）的资格。
 * 放宽契约：只受三条硬闸（未成年证据 / 受保护名单 / 机械非人形）与 minor_blocked 约束，
 * 年龄未确认不再拦；与 canRevealNpcMeasurements（三围）刻意不同。
 */
export function canUseNsfwPrivateFields(input: {
  name: string; aliases?: readonly string[]; description?: string;
  ageConfirmation?: 'adult' | 'unknown' | 'minor_blocked';
  ageSource?: 'canonical' | 'manual' | 'legacy_unverified';
}): boolean {
  return resolveNpcAdultEligibility({
    name: input.name, aliases: input.aliases, description: input.description,
    ageConfirmation: input.ageConfirmation, ageSource: input.ageSource,
    canonicalBaselineAge: getCanonicalArchiveBaselineAge(input.name),
  }).confirmed;
}

export function canRevealNpcRecordMeasurements(npc: NPC记录): boolean {
  return canRevealNpcMeasurements({
    name: npc.姓名, aliases: npc.别名 ? [npc.别名] : [], gender: npc.性别,
    description: [npc.介绍, npc.外貌, ...(npc.备注 ?? [])].filter(Boolean).join(' '),
    ageConfirmation: npc.NSFW档案?.年龄确认, ageSource: npc.NSFW档案?.年龄确认来源,
  });
}

export function normalizeNpcAppearanceFacts(raw: unknown, eligibleForMeasurements: boolean): NPC外貌档案 | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  const result: NPC外貌档案 = {};
  for (const key of NPC_APPEARANCE_KEYS) {
    if (key === '三围' && !eligibleForMeasurements) continue;
    const entry = value[key];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const fact = entry as Record<string, unknown>;
    const text = typeof fact.value === 'string' ? fact.value.trim() : '';
    const source = fact.source;
    if (!text || source !== 'canon' && source !== 'manual' && source !== 'narrative' && source !== 'ai_estimate') continue;
    result[key] = { value: text, source };
  }
  return Object.keys(result).length ? result : undefined;
}
