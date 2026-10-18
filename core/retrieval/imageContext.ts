import type { CoreSnapshot, NpcState } from '../contracts/state';
import type { API配置项 } from '@/models/settings';
import type { ImageGenerationRequest } from '@/services/ai/imageGeneration';
import { readSourceImageCharacterFacts, type ImageCharacterFacts } from '@/utils/imageCharacterFacts';
import { normalizeImageCharacterEnglishCache, type ImageCharacterEnglishCache } from '@/models/imageCharacterEnglish';
import { buildCoreVisualContext } from './consumerContext';
import { sameData } from '../persistence/repositoryValidation';
import type { CoreImageRequest } from '../jobs/imageJob';

export type CoreImageCharacterPreparer = (facts: ImageCharacterFacts, config: API配置项 | null, signal?: AbortSignal) => Promise<ImageCharacterEnglishCache>;
export function readCoreNpcImageFacts(npc: NpcState): ImageCharacterFacts {
  return readSourceImageCharacterFacts({ 姓名: npc.姓名, 别名: npc.aliases.join('、'), 性别: npc.gender, 外貌: npc.appearance,
    穿着: npc.clothing, 外貌档案: npc.appearanceFacts, 介绍: npc.说明,
    ...(npc.matureArchive ? { NSFW档案: { 年龄确认: npc.matureArchive.ageConfirmation, 年龄确认来源: npc.matureArchive.ageConfirmationSource } } : {}) });
}
/** A typed English packet must be the persisted translation of this character. */
export function validateCoreImageCharacters(snapshot: CoreSnapshot, request: CoreImageRequest): void {
  for (const [index, id] of request.npcIds.entries()) {
    const npc = snapshot.records.find(row => row.domain === 'npc' && row.entityId === id), cache = npc?.domain === 'npc' && normalizeImageCharacterEnglishCache(npc.value.visualArchive.englishFacts);
    if (npc?.domain !== 'npc' || npc.value.archived || !cache || cache.sourceKey !== JSON.stringify(readCoreNpcImageFacts(npc.value))
      || !sameData(JSON.parse(JSON.stringify(cache.facts)), request.characters[index])) throw Error('CORE2_IMAGE_ENGLISH_MISMATCH：请先准备并保存该角色的英文资料。');
  }
}
/** Called by the explicit image preparation action, never by panel rendering.
 * No implicit legacy/global cache: the owning runtime must supply its port. */
export async function buildCoreImageRequest(input: { snapshot: CoreSnapshot; npcId: string; userInput: string; positive?: string[]; negative?: string[]; translationConfig: API配置项 | null; signal?: AbortSignal }, deps: { prepare?: CoreImageCharacterPreparer }) {
  if (!deps.prepare) throw Error('CORE2_IMAGE_PREPARER_REQUIRED');
  const owned = structuredClone({ ...input, signal: undefined }), npc = owned.snapshot.records.find(row => row.domain === 'npc' && row.entityId === owned.npcId);
  if (npc?.domain !== 'npc') throw Error('CORE2_IMAGE_CHARACTER_MISSING');
  const facts = readCoreNpcImageFacts(npc.value);
  const key = JSON.stringify(facts), cached = normalizeImageCharacterEnglishCache(npc.value.visualArchive.englishFacts);
  const englishCache = cached?.sourceKey === key ? cached : await deps.prepare(facts, owned.translationConfig, input.signal);
  if (input.signal?.aborted) throw Error('CORE2_IMAGE_PREPARATION_CANCELLED');
  if (englishCache.sourceKey !== key || !normalizeImageCharacterEnglishCache(englishCache)) throw Error('CORE2_IMAGE_TRANSLATION_SOURCE');
  const context = buildCoreVisualContext({ userInput: owned.userInput, imageFacts: englishCache.facts, positive: owned.positive, negative: owned.negative });
  const request: ImageGenerationRequest = { prompt: context.prompt, negativePrompt: context.negative, signal: input.signal,
    protectedCharacters: [{ name: englishCache.facts.name, visualPrompt: englishCache.facts.appearance ?? '', facts: englishCache.facts }] };
  return { request, englishCache, scope: owned.snapshot.head.scope, npcId: owned.npcId, context };
}
