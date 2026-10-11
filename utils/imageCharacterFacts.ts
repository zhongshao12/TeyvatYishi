import type { NPC外貌档案, NPC_NSFW档案 } from '@/models/npc';
import { canRevealNpcMeasurements, normalizeNpcAppearanceFacts, NPC_APPEARANCE_KEYS, npcAppearanceSourceLabel } from '@/services/npcAppearanceFacts';
import { omitNpcAppearanceMeasurements, reconcileNpcAppearance } from '@/utils/npcAppearanceReconciliation';

/** Read-only profile input: private archive fields are used solely by the existing eligibility gate. */
export interface ImageCharacterFactInput {
  姓名?: string;
  别名?: string;
  性别?: string;
  外貌?: string;
  穿着?: string;
  介绍?: string;
  备注?: string[];
  外貌档案?: NPC外貌档案;
  身高?: string;
  NSFW档案?: NPC_NSFW档案;
}

export interface ImageCharacterFacts {
  name: string;
  gender?: string;
  appearance?: string;
  outfit?: string;
  appearanceDetails?: NPC外貌档案;
  /** Traveler top-level profile field; it has no canon/manual/narrative source enum. */
  profileHeight?: string;
}

/** No inference or NPC mutation: emit only recorded, permitted visual facts. */
export function readImageCharacterFacts(character: ImageCharacterFactInput): ImageCharacterFacts {
  const name = character.姓名?.trim() || 'Traveler';
  const eligible = canRevealNpcMeasurements({
    name, aliases: character.别名 ? [character.别名] : [], gender: character.性别,
    description: [character.介绍, character.外貌, ...(character.备注 ?? [])].filter(Boolean).join(' '),
    ageConfirmation: character.NSFW档案?.年龄确认, ageSource: character.NSFW档案?.年龄确认来源,
  });
  const appearanceDetails = normalizeNpcAppearanceFacts(character.外貌档案, eligible);
  const overview = character.外貌?.trim();
  const outfit = character.穿着?.trim();
  return {
    name,
    gender: character.性别?.trim() || undefined,
    appearance: reconcileNpcAppearance(overview && !eligible ? omitNpcAppearanceMeasurements(overview) : overview, appearanceDetails) || undefined,
    outfit: outfit && !eligible ? omitNpcAppearanceMeasurements(outfit) || undefined : outfit || undefined,
    appearanceDetails,
    profileHeight: appearanceDetails?.身高 ? undefined : character.身高?.trim() || undefined,
  };
}

/** Provenance stays attached to its recorded value, including AI estimates. */
export function formatImageCharacterFacts(facts: ImageCharacterFacts): string {
  return [
    `character name: ${facts.name}`,
    facts.gender ? `gender: ${facts.gender}` : '',
    facts.appearance ? `appearance: ${facts.appearance}` : '',
    facts.profileHeight ? `身高: ${facts.profileHeight} (source: traveler_profile; 旅人档案)` : '',
    ...NPC_APPEARANCE_KEYS.flatMap(key => {
      const fact = facts.appearanceDetails?.[key];
      return fact ? [`${key}: ${fact.value} (source: ${fact.source}; ${npcAppearanceSourceLabel(fact.source)})`] : [];
    }),
    facts.outfit ? `outfit: ${facts.outfit}` : '',
  ].filter(Boolean).join('\n');
}

const VISUAL_COLORS = [
  ['black', 'black', '黑'], ['white', 'white', '白'], ['silver', 'silver', '银'],
  ['gold', 'gold(?:en)?|blond(?:e)?', '金'], ['brown', 'brown', '棕|褐'],
  ['amber', 'amber', '琥珀'], ['red', 'red', '红'], ['blue', 'blue', '蓝'],
  ['green', 'green', '绿'], ['purple', 'purple|violet', '紫'], ['pink', 'pink', '粉'],
  ['gray', 'gr[ae]y', '灰'],
] as const;

function fieldColorPattern(field: '发色' | '瞳色', english: string, chinese: string): string {
  const englishFeature = field === '发色' ? 'hair' : 'eyes?';
  const chineseFeature = field === '发色' ? '(?:色)?(?:长|短)?(?:头)?发' : '(?:色)?(?:眼睛|眼眸|瞳)';
  return `\\b(?:${english})(?:[- ](?:long|short|curly|straight|wavy))?[- ]${englishFeature}\\b|\\b${englishFeature}(?: colou?r)?\\s*[:=]\\s*(?:${english})\\b|(?:${chinese})${chineseFeature}|${field}(?:标签)?\\s*[:：]\\s*(?:${english}|${chinese})`;
}

function colorsInField(text: string, field?: '发色' | '瞳色'): string[] {
  return VISUAL_COLORS.filter(([, english, chinese]) => {
    if (!field) return new RegExp(`\\b(?:${english})\\b|${chinese}`, 'i').test(text);
    return new RegExp(fieldColorPattern(field, english, chinese), 'i').test(text);
  }).map(([color]) => color);
}

/** Remove only a contradictory color token, not accessories or other identity details in its clause. */
export function removeContradictoryImageColors(text: string, anchorText: string): string {
  let result = text;
  for (const field of ['发色', '瞳色'] as const) {
    const anchorColors = colorsInField(anchorText, field);
    if (anchorColors.length !== 1) continue;
    for (const [color, english, chinese] of VISUAL_COLORS) {
      if (color === anchorColors[0]) continue;
      result = result.replace(new RegExp(fieldColorPattern(field, english, chinese), 'gi'), match =>
        match.replace(new RegExp(`\\b(?:${english})\\b|(?:${chinese})(?:色)?`, 'i'), '').replace(/\s{2,}/g, ' ').trim(),
      );
    }
  }
  return result.trim();
}

/** Only resolve recognizable color contradictions; unfamiliar or ambiguous descriptions stay untouched. */
export function resolveImageCharacterFactsForAnchor(facts: ImageCharacterFacts, anchorText: string): ImageCharacterFacts {
  if (!anchorText) return facts;
  const appearanceDetails = { ...facts.appearanceDetails };
  for (const field of ['发色', '瞳色'] as const) {
    const anchorColors = colorsInField(anchorText, field);
    if (anchorColors.length !== 1) continue;
    const conflicts = (colors: string[]) => colors.length === 1 && colors[0] !== anchorColors[0];
    const recorded = appearanceDetails[field];
    if (recorded && conflicts(colorsInField(recorded.value))) delete appearanceDetails[field];
  }
  const appearance = facts.appearance ? removeContradictoryImageColors(facts.appearance, anchorText) || undefined : undefined;
  return { ...facts, appearance, appearanceDetails: Object.keys(appearanceDetails).length ? appearanceDetails : undefined };
}
