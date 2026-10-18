import type { API配置项 } from '@/models/settings';
import { containsCjk, normalizeImageCharacterEnglishCache, sameImageMeasurement, type ImageCharacterEnglishCache } from '@/models/imageCharacterEnglish';
import type { ImageCharacterFacts } from '@/utils/imageCharacterFacts';
import { NPC_APPEARANCE_KEYS } from '@/services/npcAppearanceFacts';
import { chatCompletionNonStream } from './chatCompletionClient';

/** Translation only. The owning runtime decides whether/where to retain it. */
export async function translateImageCharacterFacts(facts: ImageCharacterFacts, config: API配置项 | null, signal?: AbortSignal, complete = chatCompletionNonStream): Promise<ImageCharacterEnglishCache> {
  const check = () => { if (signal?.aborted) throw new DOMException('英文资料准备已取消', 'AbortError'); };
  check();
  const source = structuredClone(facts), sourceKey = JSON.stringify(source);
  if (!containsCjk(JSON.stringify(Object.values({ ...source, appearanceDetails: undefined })))
    && !Object.values(source.appearanceDetails ?? {}).some(fact => containsCjk(fact.value))) {
    return { schemaVersion: 1, sourceKey, preparedAt: Date.now(), facts: { ...source, language: 'en' } };
  }
  if (!config) throw new Error('角色英文生图资料尚未准备。请配置文字接口，再点击准备/确认；不会在启动时自动翻译。');
  const raw = await complete(config, { signal, maxTokens: 1600, temperature: 0,
    systemPrompt: 'Translate only the supplied visible character profile into concise English for anime image generation. Use the established English character name when known, otherwise a stable romanization; never replace a custom name with a canon character. Preserve every recorded visual detail and exact numeric value/unit. Never invent measurements, outfits, events, relationships, sexual details or personality. Return JSON with name, gender, appearance, outfit, profileHeight and appearanceDetails. appearanceDetails uses the original Chinese keys and each entry has value; omit fields absent in the source. No Markdown.',
    messages: [{ role: 'user', content: sourceKey }],
  });
  check();
  let translated: ImageCharacterFacts;
  try { translated = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new Error('英文外貌翻译返回了无效格式，请重试；中文档案未修改。'); }
  if (!translated || typeof translated !== 'object' || Array.isArray(translated)) throw new Error('英文外貌翻译返回了无效格式，请重试；中文档案未修改。');
  for (const field of ['name', 'gender', 'appearance', 'outfit', 'profileHeight'] as const) {
    if (source[field] && (!translated[field] || typeof translated[field] !== 'string' || containsCjk(translated[field]!))) throw new Error('英文外貌翻译遗漏了已记录资料，请重试。');
    if (!source[field] && translated[field]) throw new Error('英文外貌翻译添加了未记录资料，请重试。');
  }
  if (source.profileHeight && !sameImageMeasurement(source.profileHeight, translated.profileHeight!)) throw new Error('英文旅人身高与已记录数值不一致，请重试。');
  const appearanceDetails = Object.fromEntries(NPC_APPEARANCE_KEYS.flatMap(field => {
    const original = source.appearanceDetails?.[field], value = translated.appearanceDetails?.[field]?.value;
    if (!original && value) throw new Error('英文外貌细项添加了未记录数值，请重试。');
    if (!original) return [];
    if (!value || typeof value !== 'string' || containsCjk(value)
      || (['身高', '体重', '三围'].includes(field) && !sameImageMeasurement(original.value, value))) throw new Error('英文外貌细项与已记录数值不一致，请重试。');
    return [[field, { ...original, value }]];
  }));
  const result = normalizeImageCharacterEnglishCache({ schemaVersion: 1, sourceKey, preparedAt: Date.now(), facts: {
    language: 'en', name: translated.name, gender: translated.gender, appearance: translated.appearance, outfit: translated.outfit, profileHeight: translated.profileHeight,
    appearanceDetails: Object.keys(appearanceDetails).length ? appearanceDetails : undefined,
  } });
  if (!result) throw new Error('英文外貌翻译未通过校验，请重试。');
  check();
  return result;
}
