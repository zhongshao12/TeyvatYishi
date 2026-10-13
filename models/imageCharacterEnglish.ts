import type { NPC外貌档案 } from './npc';

/** Derived image-only data; never replaces the Chinese gameplay profile. */
export interface EnglishImageCharacterFacts {
  language: 'en';
  name: string;
  gender?: string;
  appearance?: string;
  outfit?: string;
  appearanceDetails?: NPC外貌档案;
  profileHeight?: string;
}
export interface ImageCharacterEnglishCache {
  schemaVersion: 1;
  sourceKey: string;
  preparedAt: number;
  facts: EnglishImageCharacterFacts;
  anchorPrompt?: string;
  anchorNegative?: string;
  anchorSourceKey?: string;
}

export const containsCjk = (value: string): boolean => /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(value);

/** Compare recorded numbers and unit spellings, without converting their values. */
export function sameImageMeasurement(source: string, translated: string): boolean {
  const canonical = (value: string) => value.toLowerCase()
    .replace(/厘米|公分|\bcentimet(?:er|re)s?\b/g, 'cm')
    .replace(/千克|公斤|\bkilograms?\b/g, 'kg')
    .replace(/毫米|\bmillimet(?:er|re)s?\b/g, 'mm')
    .replace(/英寸|\binch(?:es)?\b/g, 'in')
    .replace(/磅|\bpounds?\b|\blbs?\b/g, 'lb')
    .replace(/米|\bmet(?:er|re)s?\b/g, 'm');
  const numbers = (value: string) => value.match(/\d+(?:\.\d+)?/g) ?? [];
  const units = (value: string) => [...canonical(value).matchAll(/\d+(?:\.\d+)?\s*(cm|kg|mm|in|lb|m)(?![a-z])/g)].map(match => match[1]);
  return JSON.stringify(numbers(source)) === JSON.stringify(numbers(translated))
    && JSON.stringify(units(source)) === JSON.stringify(units(translated));
}

function readJsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

export function validEnglishVisualAnchor(source: string | undefined, translated: unknown): boolean {
  if (!source?.trim()) return translated === undefined || translated === '';
  return typeof translated === 'string' && Boolean(translated.trim()) && !containsCjk(translated) && sameImageMeasurement(source, translated);
}

/** Revalidate imported facts against their recorded source; readers also check that source is still current. */
export function normalizeImageCharacterEnglishCache(value: unknown): ImageCharacterEnglishCache | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as ImageCharacterEnglishCache;
  if (raw.schemaVersion !== 1 || typeof raw.sourceKey !== 'string' || !raw.sourceKey || !raw.facts
    || raw.facts.language !== 'en' || typeof raw.facts.name !== 'string' || !raw.facts.name.trim()) return undefined;
  const source = readJsonRecord(raw.sourceKey);
  if (!source || typeof source.name !== 'string' || !source.name.trim()) return undefined;
  const values = [raw.facts.name, raw.facts.gender, raw.facts.appearance, raw.facts.outfit, raw.facts.profileHeight];
  if (values.some(item => item !== undefined && (typeof item !== 'string' || containsCjk(item)))) return undefined;
  for (const key of ['name', 'gender', 'appearance', 'outfit', 'profileHeight'] as const) {
    const before = source[key]; const after = raw.facts[key];
    if (before !== undefined && typeof before !== 'string') return undefined;
    if (Boolean(typeof before === 'string' && before.trim()) !== Boolean(after?.trim())) return undefined;
    if (['appearance', 'outfit', 'profileHeight'].includes(key) && !sameImageMeasurement(typeof before === 'string' ? before : '', after ?? '')) return undefined;
  }
  const sourceDetails = source.appearanceDetails;
  if (sourceDetails !== undefined && (!sourceDetails || typeof sourceDetails !== 'object' || Array.isArray(sourceDetails))) return undefined;
  const details: NPC外貌档案 = {};
  for (const key of ['发色', '瞳色', '身高', '体重', '三围'] as const) {
    const original = (sourceDetails as NPC外貌档案 | undefined)?.[key];
    const fact = raw.facts.appearanceDetails?.[key];
    if (Boolean(original) !== Boolean(fact)) return undefined;
    if (!fact) continue;
    if (!original || typeof original.value !== 'string' || typeof fact.value !== 'string' || !fact.value.trim() || containsCjk(fact.value)
      || !['canon', 'manual', 'narrative', 'ai_estimate'].includes(fact.source) || original.source !== fact.source
      || !sameImageMeasurement(original.value, fact.value)) return undefined;
    details[key] = { value: fact.value, source: fact.source };
  }
  const anchorSource = readJsonRecord(raw.anchorSourceKey);
  const validAnchors = anchorSource && typeof anchorSource.prompt === 'string' && typeof anchorSource.negative === 'string'
    && validEnglishVisualAnchor(anchorSource.prompt, raw.anchorPrompt) && validEnglishVisualAnchor(anchorSource.negative, raw.anchorNegative);
  return { schemaVersion: 1, sourceKey: raw.sourceKey, preparedAt: Number.isFinite(raw.preparedAt) ? raw.preparedAt : 0,
    facts: { language: 'en', name: raw.facts.name, gender: raw.facts.gender, appearance: raw.facts.appearance, outfit: raw.facts.outfit,
      profileHeight: raw.facts.profileHeight, appearanceDetails: Object.keys(details).length ? details : undefined },
    // A broken anchor invalidates only that derived slice; valid profile facts survive.
    anchorPrompt: validAnchors ? raw.anchorPrompt : undefined, anchorNegative: validAnchors ? raw.anchorNegative : undefined,
    anchorSourceKey: validAnchors ? raw.anchorSourceKey : undefined };
}
