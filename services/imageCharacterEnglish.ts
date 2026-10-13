import type { API配置项, API设置, 文生图系统设置 } from '@/models/settings';
import { containsCjk, normalizeImageCharacterEnglishCache, sameImageMeasurement, validEnglishVisualAnchor, type ImageCharacterEnglishCache, type EnglishImageCharacterFacts } from '@/models/imageCharacterEnglish';
import { loadSetting, saveSetting } from '@/services/dbService';
import { chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import { NPC_APPEARANCE_KEYS } from '@/services/npcAppearanceFacts';
import { formatImageCharacterFacts, type ImageCharacterFacts } from '@/utils/imageCharacterFacts';
import { compactImagePrompts, removeDisabledImageCharacterCaptions, type PromptCharacter } from '@/utils/imagePromptCompaction';
import { STORY_SNAPSHOT_CONTEXT_LIMITS, type StorySnapshotRenderContext } from '@/models/imageGeneration';

export function buildImageCharacterEnglishConfig(settings: 文生图系统设置, apiSettings?: API设置): API配置项 | null {
  const main = apiSettings?.configs.find(item => item.id === apiSettings.activeConfigId) ?? apiSettings?.configs[0];
  if (!main) return null;
  const override = settings.词组转化器API;
  const hasOverride = Boolean(override?.baseUrl?.trim() || override?.apiKey?.trim() || override?.model?.trim());
  return { ...main, id: '__image_character_english__', name: '角色英文生图资料',
    provider: hasOverride ? override?.provider || main.provider : main.provider, baseUrl: override?.baseUrl?.trim() || main.baseUrl,
    apiKey: override?.apiKey?.trim() || main.apiKey, model: override?.model?.trim() || main.model,
    temperature: 0, maxTokens: 1600, updatedAt: Date.now() };
}

const abort = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException('英文资料准备已取消', 'AbortError'); };
function storageKey(sourceKey: string): string {
  let hash = 2166136261;
  for (const char of sourceKey) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `image-character-english-v1:${(hash >>> 0).toString(16)}`;
}

const preparationsWithoutSignal = new Map<string, Promise<ImageCharacterEnglishCache>>();
const preparationsBySignal = new WeakMap<AbortSignal, Map<string, Promise<ImageCharacterEnglishCache>>>();
/** Sharing is limited to one cancellation domain; cancelling one UI never cancels another UI. */
export function prepareEnglishImageCharacter(facts: ImageCharacterFacts, config: API配置项 | null, signal?: AbortSignal): Promise<ImageCharacterEnglishCache> {
  let pending = signal ? preparationsBySignal.get(signal) : preparationsWithoutSignal;
  if (!pending) { pending = new Map(); preparationsBySignal.set(signal!, pending); }
  // Credentials stay only in this ephemeral cancellation-domain map, never in logs or storage.
  const key = JSON.stringify([facts, config?.id, config?.provider, config?.baseUrl, config?.model, config?.apiKey, config?.enableClaudeMode]);
  const shared = pending.get(key);
  if (shared) return shared;
  const operation = prepareEnglishImageCharacterUnshared(facts, config, signal).finally(() => pending!.delete(key));
  pending.set(key, operation);
  return operation;
}

/** Only call from an explicit prepare/confirm action, never from a render or startup. */
async function prepareEnglishImageCharacterUnshared(facts: ImageCharacterFacts, config: API配置项 | null, signal?: AbortSignal): Promise<ImageCharacterEnglishCache> {
  abort(signal);
  const sourceKey = JSON.stringify(facts);
  const key = storageKey(sourceKey);
  const cached = normalizeImageCharacterEnglishCache(await loadSetting(key));
  abort(signal);
  if (cached?.sourceKey === sourceKey) return cached;
  if (!containsCjk(JSON.stringify(Object.values({ ...facts, appearanceDetails: undefined })))
    && !Object.values(facts.appearanceDetails ?? {}).some(fact => containsCjk(fact.value))) {
    return { schemaVersion: 1, sourceKey, preparedAt: Date.now(), facts: { ...facts, language: 'en' } };
  }
  if (!config) throw new Error('角色英文生图资料尚未准备。请配置文字接口，再点击准备/确认；不会在启动时自动翻译。');
  const raw = await chatCompletionNonStream(config, { signal, maxTokens: 1600, temperature: 0,
    systemPrompt: 'Translate only the supplied visible character profile into concise English for anime image generation. Use the established English character name when known, otherwise a stable romanization; never replace a custom name with a canon character. Preserve every recorded visual detail and exact numeric value/unit. Never invent measurements, outfits, events, relationships, sexual details or personality. Return JSON with name, gender, appearance, outfit, profileHeight and appearanceDetails. appearanceDetails uses the original Chinese keys and each entry has value; omit fields absent in the source. No Markdown.',
    messages: [{ role: 'user', content: JSON.stringify(facts) }],
  });
  abort(signal);
  let translated: ImageCharacterFacts;
  try { translated = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
  catch { throw new Error('英文外貌翻译返回了无效格式，请重试；中文档案未修改。'); }
  if (!translated || typeof translated !== 'object' || Array.isArray(translated)) throw new Error('英文外貌翻译返回了无效格式，请重试；中文档案未修改。');
  for (const field of ['name', 'gender', 'appearance', 'outfit', 'profileHeight'] as const) {
    if (facts[field] && (!translated[field] || typeof translated[field] !== 'string' || containsCjk(translated[field]!))) throw new Error('英文外貌翻译遗漏了已记录资料，请重试。');
    if (!facts[field] && translated[field]) throw new Error('英文外貌翻译添加了未记录资料，请重试。');
  }
  if (facts.profileHeight && !sameImageMeasurement(facts.profileHeight, translated.profileHeight!)) throw new Error('英文旅人身高与已记录数值不一致，请重试。');
  const appearanceDetails = Object.fromEntries(NPC_APPEARANCE_KEYS.flatMap(field => {
    const original = facts.appearanceDetails?.[field]; const value = translated.appearanceDetails?.[field]?.value;
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
  abort(signal); await saveSetting(key, result); abort(signal);
  return result;
}

async function translateVisualAnchor(text: string | undefined, config: API配置项 | null, signal?: AbortSignal): Promise<string | undefined> {
  if (!text || !containsCjk(text)) return text;
  const key = storageKey(`anchor:${text}`);
  const stored = await loadSetting<{ source: string; english: string }>(key);
  abort(signal);
  if (stored?.source === text && validEnglishVisualAnchor(text, stored.english)) return stored.english;
  if (!config) throw new Error('稳定外貌锚点还没有英文版本，请配置文字接口后重新准备。');
  const english = (await chatCompletionNonStream(config, { signal, temperature: 0, maxTokens: 1600,
    systemPrompt: 'Translate this visible image appearance anchor into concise English. Preserve every identifying feature, all numbers and units, and negative terms. Do not add any feature. Output only the translated text, no explanation or Markdown.',
    messages: [{ role: 'user', content: text }],
  })).trim();
  abort(signal);
  if (!validEnglishVisualAnchor(text, english)) throw new Error('稳定外貌锚点英文翻译未通过校验，请重试。');
  await saveSetting(key, { source: text, english });
  abort(signal);
  return english;
}

export async function prepareEnglishProfileCache(facts: ImageCharacterFacts, config: API配置项 | null, anchors: { prompt?: string; negative?: string }, signal?: AbortSignal) {
  const base = await prepareEnglishImageCharacter(facts, config, signal);
  const sourceKey = JSON.stringify({ prompt: anchors.prompt || '', negative: anchors.negative || '' });
  if (base.anchorSourceKey === sourceKey) return base;
  const anchorPrompt = await translateVisualAnchor(anchors.prompt, config, signal);
  const anchorNegative = await translateVisualAnchor(anchors.negative, config, signal);
  const cache = { ...base, anchorPrompt, anchorNegative, anchorSourceKey: sourceKey };
  abort(signal); await saveSetting(storageKey(base.sourceKey), cache); abort(signal);
  return cache;
}

export async function prepareEnglishPromptCharacters(characters: readonly PromptCharacter[], config: API配置项 | null, signal?: AbortSignal) {
  const caches: ImageCharacterEnglishCache[] = [];
  const prepared: PromptCharacter[] = [];
  for (const character of characters) {
    if (character.enabled === false || !character.facts) { prepared.push(character); continue; }
    const cache = await prepareEnglishImageCharacter(character.facts, config, signal);
    caches.push(cache);
    const anchorPrompt = await translateVisualAnchor(character.anchorPrompt, config, signal);
    const negativePrompt = await translateVisualAnchor(character.negativePrompt, config, signal);
    prepared.push({ ...character, name: cache.facts.name, facts: cache.facts, anchorPrompt, negativePrompt,
      visualPrompt: anchorPrompt || [cache.facts.appearance, cache.facts.outfit].filter(Boolean).join(', ') });
  }
  return { characters: prepared, caches };
}

/** Replace the old profile text, then protect the English facts from compaction. */
export async function prepareEnglishImagePrompts(input: { prompt: string; negative: string; characters?: readonly PromptCharacter[] }, config: API配置项 | null, signal?: AbortSignal) {
  const original = input.characters ?? [];
  const result = await prepareEnglishPromptCharacters(original, config, signal);
  let prompt = input.prompt; let negative = input.negative;
  original.forEach((source, index) => {
    const prepared = result.characters[index];
    if (!source.facts || !prepared?.facts || source.enabled === false) return;
    prompt = prompt.replaceAll(formatImageCharacterFacts(source.facts), '');
    if (source.anchorPrompt) prompt = prompt.replaceAll(source.anchorPrompt, prepared.anchorPrompt ?? '');
    if (source.negativePrompt) negative = negative.replaceAll(source.negativePrompt, prepared.negativePrompt ?? '');
    for (const field of ['name', 'gender', 'appearance', 'outfit', 'profileHeight'] as const) {
      const before = source.facts[field]; const after = prepared.facts[field];
      if (before && after && before !== after) {
        const escaped = before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (field === 'gender' || before.length === 1) prompt = prompt.replace(new RegExp(`((?:character name|player character name|gender|appearance|outfit|height)\\s*:\\s*)${escaped}(?=[\\s,，;；]|$)`, 'g'), (_match, label) => `${label}${after}`);
        else prompt = prompt.replaceAll(before, after);
      }
    }
    for (const field of NPC_APPEARANCE_KEYS) {
      const before = source.facts.appearanceDetails?.[field]?.value;
      const after = prepared.facts.appearanceDetails?.[field]?.value;
      if (before && after && before !== after && before.length > 1) prompt = prompt.replaceAll(before, after);
    }
  });
  return { ...compactImagePrompts({ prompt, negative, characters: result.characters }), ...result };
}

export async function prepareEnglishStoryImage(input: { prompt: string; negative: string; characters: readonly PromptCharacter[]; renderContext: StorySnapshotRenderContext }, config: API配置项 | null, signal?: AbortSignal) {
  const activeNames = new Set(input.renderContext.characters.filter(character => character.enabled !== false).map(character => character.name));
  const sources = input.characters.map(character => ({ ...character, enabled: character.enabled !== false && activeNames.has(character.name) }));
  const stripDisabled = (text: string) => removeDisabledImageCharacterCaptions(text, [...sources, ...input.renderContext.characters]);
  const prepared = await prepareEnglishImagePrompts({ ...input, prompt: stripDisabled(input.prompt), characters: sources.filter(character => character.enabled) }, config, signal);
  const characters = [];
  for (const character of input.renderContext.characters) {
    const source = sources.find(item => item.enabled && item.name === character.name);
    if (!source || character.enabled === false) { characters.push(character); continue; }
    const english = await prepareEnglishImagePrompts({ prompt: character.visualPrompt, negative: character.negativePrompt, characters: [source] }, config, signal);
    const compacted = compactImagePrompts({ ...english, characters: english.characters, limit: STORY_SNAPSHOT_CONTEXT_LIMITS.characterPrompt, negativeLimit: STORY_SNAPSHOT_CONTEXT_LIMITS.characterNegativePrompt });
    // Chinese names are stable story identifiers; only the actual visual payload is English.
    const protectedCharacter = english.characters[0];
    characters.push({ ...character, visualPrompt: compacted.prompt, negativePrompt: compacted.negative,
      facts: protectedCharacter?.facts?.language === 'en' ? protectedCharacter.facts as EnglishImageCharacterFacts : undefined,
      anchorPrompt: protectedCharacter?.anchorPrompt });
  }
  return { ...prepared, renderContext: { ...input.renderContext, scenePrompt: stripDisabled(input.renderContext.scenePrompt),
    stylePrompt: input.renderContext.stylePrompt ? stripDisabled(input.renderContext.stylePrompt) : undefined, characters } };
}
