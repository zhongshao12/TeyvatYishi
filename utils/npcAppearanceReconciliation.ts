import type { NPC外貌档案 } from '@/models/npc';

// This module is deliberately dependency-free at runtime. Callers must pass only permitted facts.
const COLOR_BASE = '(?:(?:浅|深|淡|暗|亮|乌|墨|浓|黯|苍|海|天|钢|樱|奶|米|血|酒|玫|亚麻|翡翠|祖母|橄榄|枫叶|宝石|碧)*)(?:紫罗兰|琥珀|[黑白银金棕褐红蓝绿紫粉灰青赤橙黄栗靛碧绯]+)(?:色)?';
const COLOR = `${COLOR_BASE}(?:(?:带|泛|渐变|偏|底|相间|交织)${COLOR_BASE})*`;
// Guard against matching only the tail of an unfamiliar compound shade (e.g. 雾蓝 → 雾绿).
const COLOR_BOUNDARY = '(?<![黑白银金棕褐红蓝绿紫粉灰青赤橙黄栗靛碧绯浅深淡暗亮乌墨浓黯苍海天钢樱奶米血酒玫雾霜雪])';
const ENGLISH_COLOR = '(?:silver[- ]white|silver|blond(?:e)?|gold(?:en)?|brown|amber|black|white|red|blue|green|purple|violet|pink|gr[ae]y)';
const CN_HAIR = '(?:(?:长|短|卷|直|波浪|柔顺|浓密|微|鬈){0,6}(?:头)?发)(?!带|卡|饰|箍|夹|冠|簪|绳)';
const CN_EYE = '(?:眼睛|眼眸|双眼|瞳孔|瞳色|瞳)';
const TRIPLE = '\\d{2,3}(?:\\.\\d+)?\\s*[/／-]\\s*\\d{2,3}(?:\\.\\d+)?\\s*[/／-]\\s*\\d{2,3}(?:\\.\\d+)?\\s*(?:cm|厘米)';
const MEASUREMENTS = new RegExp(`(?:三围|胸[／/-]腰[／/-]臀|measurements?|bust[/-]waist[/-]hips?)\\s*(?:[:：=]|为|是)?\\s*(?:约|大约)?\\s*${TRIPLE}`, 'giu');

function colorIdentity(value: string): string {
  return value.toLocaleLowerCase().replace(/色$/u, '').replace(/blonde?|golden|金/gu, 'gold')
    .replace(/棕|褐/gu, 'brown').replace(/琥珀/gu, 'amber').replace(/银白|silver[- ]white/gu, 'silverwhite')
    .replace(/银/gu, 'silver').replace(/黑/gu, 'black').replace(/白/gu, 'white').replace(/红/gu, 'red')
    .replace(/蓝/gu, 'blue').replace(/绿/gu, 'green').replace(/紫|violet/gu, 'purple').replace(/粉/gu, 'pink').replace(/灰|grey/gu, 'gray');
}

function recordedColor(value: string): string | undefined {
  if (new RegExp(`^${ENGLISH_COLOR}$`, 'iu').test(value)) return value;
  // Canon fields often include hairstyle/eye descriptions; retain that full sourced value in facts,
  // and project only its explicit color into prose rather than duplicating the hairstyle.
  return value.match(new RegExp(`^(?:温和|清澈|澄澈|纯澈|纯净|清冽|冷彻|明亮|幽沉|幽|冷淡|刚毅|柔顺|层次)?(${COLOR})`, 'u'))?.[1];
}

/** Replace only explicit conflicting features, retaining hairstyle, accessories and the rest of the prose. */
export function reconcileNpcAppearance(appearance: string | undefined, facts: NPC外貌档案 | undefined): string | undefined {
  if (!appearance || !facts) return appearance;
  let result = appearance;
  for (const key of ['发色', '瞳色'] as const) {
    const recorded = facts[key]?.value.trim();
    const value = recorded ? recordedColor(recorded) : undefined;
    if (!value) continue;
    const replaceColor = (old: string) => colorIdentity(old) === colorIdentity(value) ? old : value;
    const cnFeature = key === '发色' ? CN_HAIR : CN_EYE;
    result = result.replace(new RegExp(`${COLOR_BOUNDARY}(${COLOR})((?:的)?${cnFeature})`, 'gu'), (_match, old: string, feature: string) => replaceColor(old) + feature);
    result = result.replace(new RegExp(`(${key}\\s*(?:[:：=]|为|是)\\s*)(${COLOR}|${ENGLISH_COLOR})`, 'giu'), (_match, label: string, old: string) => label + replaceColor(old));
    const enFeature = key === '发色' ? 'hair' : 'eyes?';
    result = result.replace(new RegExp(`\\b(${ENGLISH_COLOR})((?:[- ](?:long|short|curly|straight|wavy)){0,2}[- ]${enFeature}\\b)`, 'giu'), (_match, old: string, feature: string) => replaceColor(old) + feature);
    result = result.replace(new RegExp(`(\\b${enFeature}(?: colou?r)?\\s*[:=]\\s*)(${ENGLISH_COLOR})\\b`, 'giu'), (_match, label: string, old: string) => label + replaceColor(old));
  }
  for (const [key, label, numeric] of [
    ['身高', '(?:身高|height)', '\\d+(?:\\.\\d+)?\\s*(?:cm|厘米)'],
    ['体重', '(?:体重|weight)', '\\d+(?:\\.\\d+)?\\s*(?:kg|千克|公斤)'],
    ['三围', '(?:三围|胸[／/-]腰[／/-]臀|measurements?|bust[/-]waist[/-]hips?)', TRIPLE],
  ] as const) {
    const value = facts[key]?.value.trim();
    if (!value || !new RegExp(`^${numeric}$`, 'iu').test(value)) continue;
    result = result.replace(new RegExp(`(${label}\\s*(?:[:：=]|为|是)?\\s*(?:约|大约)?\\s*)${numeric}`, 'giu'), (_match, prefix: string) => prefix + value);
  }
  return result;
}

/** Mixed documents require a positive appearance-section label; a color-leading story is not subject evidence. */
export function reconcileNpcAppearanceParagraphs(text: string, facts: NPC外貌档案 | undefined, scope: 'overview' | 'mixed' = 'overview'): string {
  const sectionLabel = '外貌(?:锚点|概述)?\\s*[:：]|appearance(?: anchor)?\\s*:';
  const overviewLead = `${COLOR}(?:的)?(?:${CN_HAIR}|${CN_EYE})|${ENGLISH_COLOR}[- ](?:hair|eyes?)\\b|身高|体重|三围`;
  const explicitOverview = new RegExp(`^\\s*(?:[-*•]\\s*)?(?:${sectionLabel}${scope === 'overview' ? `|${overviewLead}` : ''})`, 'iu');
  const continuation = new RegExp(`^\\s*(?:${COLOR}(?:的)?(?:${CN_HAIR}|${CN_EYE})|${ENGLISH_COLOR}[- ](?:hair|eyes?)\\b)(?=\\s*(?:[，,；;]|$))|^\\s*(?:发色|瞳色|身高|体重|三围)\\s*(?:[:：=]|为|是|\\d)`, 'iu');
  // An attributive feature introduces a possible new subject, not a standalone appearance clause.
  const attributiveSubject = new RegExp(`${COLOR}(?:${CN_HAIR}|${CN_EYE})\\s*的`, 'u');
  return text.split(/(\n+)/u).map(paragraph => {
    let appearanceScope = false;
    return paragraph.split(/([。！？!?]|(?<!\d)\.(?!\d))/u).map(segment => {
      if (!segment.trim() || /^[。！？!?.]$/u.test(segment)) return segment;
      const hasOtherSubject = /你的|他的|她的|共事|同事/u.test(segment);
      if (explicitOverview.test(segment) && !hasOtherSubject) {
        appearanceScope = true;
        return reconcileNpcAppearance(segment, facts);
      }
      if (appearanceScope && continuation.test(segment) && !hasOtherSubject && !attributiveSubject.test(segment)) {
        return reconcileNpcAppearance(segment, facts);
      }
      appearanceScope = false;
      return segment;
    }).join('');
  }).join('');
}

/** Public projections must not leak disallowed measurements already embedded in prose. */
export function omitNpcAppearanceMeasurements(text: string): string {
  return text.replace(MEASUREMENTS, '').replace(/^[，,；;\s]+|[，,；;\s]+$/gu, '');
}

/** The facts themselves, including their sources, are left untouched. */
export function reconcileNpcAppearanceRecord<T extends { 外貌?: string; 外貌档案?: NPC外貌档案 }>(record: T, permittedFacts = record.外貌档案): T {
  const appearance = reconcileNpcAppearance(record.外貌, permittedFacts);
  return appearance === record.外貌 ? record : { ...record, 外貌: appearance };
}
