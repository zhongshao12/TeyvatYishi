import type { CoreScope, SourceRef } from '../contracts/identity';
import type { JobRecord } from '../contracts/memory';
import type { CoreImageRequest } from './imageJob';
import { isCoreJsonData, validateCoreDto } from '../contracts/validation';
import { sameScope, stableJson } from '../persistence/repositoryValidation';
export const CORE_IMAGE_PLAN_PREFIX = 'core2-image-plan-v1:';
export interface CoreImagePlan { version: 1; scope: CoreScope; anchorOperationId: string; publicationOperationId: string; entryId: string; assetId: string; outputSourceRef: SourceRef; modelIdentity: string; request: CoreImageRequest }
const validId = (id: string) => validateCoreDto('sourceRef', { sourceId: id, sourceVersion: 1 }).ok;
export function ownCoreImageRequest(input: CoreImageRequest): CoreImageRequest {
  if (!isCoreJsonData(input) || Object.keys(input).length !== (input.phoneOrigin ? 8 : 7) || !Object.keys(input).every(key => ['title', 'kind', 'npcIds', 'prompt', 'negative', 'size', 'characters', 'phoneOrigin'].includes(key))
    || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 || !['character', 'scene', 'snapshot'].includes(input.kind)
    || !Array.isArray(input.npcIds) || input.npcIds.length > 20 || !input.npcIds.every(validId) || new Set(input.npcIds).size !== input.npcIds.length
    || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 40000 || typeof input.negative !== 'string' || input.negative.length > 40000
    || typeof input.size !== 'string' || !/^[1-9]\d{1,4}x[1-9]\d{1,4}$/u.test(input.size) || !Array.isArray(input.characters) || input.characters.length > 20) throw Error('CORE2_IMAGE_REQUEST_INVALID');
  for (const facts of input.characters) {
    if (!facts || facts.language !== 'en' || !validEnglishFacts(facts)) throw Error('CORE2_IMAGE_CHARACTER_INVALID');
  }
  if (input.characters.length !== input.npcIds.length || input.kind === 'character' && input.npcIds.length === 0) throw Error('CORE2_IMAGE_ENGLISH_REQUIRED');
  if (input.phoneOrigin && (Object.keys(input.phoneOrigin).length !== 3 || !Object.keys(input.phoneOrigin).every(key => ['conversationId', 'playerEventId', 'npcId'].includes(key))
    || ![input.phoneOrigin.conversationId, input.phoneOrigin.playerEventId, input.phoneOrigin.npcId].every(validId) || input.kind !== 'character' || input.npcIds.length !== 1 || input.npcIds[0] !== input.phoneOrigin.npcId)) throw Error('CORE2_IMAGE_PHONE_ORIGIN_INVALID');
  return structuredClone(input);
}
import { normalizeImageCharacterEnglishCache, type EnglishImageCharacterFacts } from '@/models/imageCharacterEnglish';
function validEnglishFacts(facts: EnglishImageCharacterFacts): boolean {
  const { language: _, ...source } = facts;
  return Object.keys(facts).every(key => ['language', 'name', 'gender', 'appearance', 'outfit', 'profileHeight', 'appearanceDetails'].includes(key))
    && (!facts.appearanceDetails || Object.entries(facts.appearanceDetails).every(([key, fact]) => ['发色', '瞳色', '身高', '体重', '三围'].includes(key) && fact && typeof fact === 'object' && Object.keys(fact).length === 2 && Object.keys(fact).every(field => ['value', 'source'].includes(field))))
    && !!normalizeImageCharacterEnglishCache({ schemaVersion: 1, sourceKey: JSON.stringify(source), preparedAt: 0, facts });
}
function own(plan: CoreImagePlan): CoreImagePlan {
  if (!isCoreJsonData(plan) || Object.keys(plan).length !== 9 || !Object.keys(plan).every(key => ['version', 'scope', 'anchorOperationId', 'publicationOperationId', 'entryId', 'assetId', 'outputSourceRef', 'modelIdentity', 'request'].includes(key))
    || plan.version !== 1 || !validateCoreDto('scope', plan.scope).ok || !validateCoreDto('sourceRef', plan.outputSourceRef).ok || plan.outputSourceRef.sourceVersion !== 1
    || ![plan.anchorOperationId, plan.publicationOperationId, plan.entryId, plan.assetId].every(validId) || typeof plan.modelIdentity !== 'string' || !plan.modelIdentity.trim() || plan.modelIdentity.length > 2000) throw Error('CORE2_IMAGE_PLAN_INVALID');
  ownCoreImageRequest(plan.request); return structuredClone(plan);
}
export const serializeCoreImagePlan = (plan: CoreImagePlan) => CORE_IMAGE_PLAN_PREFIX + stableJson(own(plan));
export function readCoreImagePlan(job: JobRecord): CoreImagePlan {
  if (job.kind !== 'image' || !job.configFingerprint.startsWith(CORE_IMAGE_PLAN_PREFIX)) throw Error('CORE2_IMAGE_PLAN_UNSUPPORTED');
  const plan = own(JSON.parse(job.configFingerprint.slice(CORE_IMAGE_PLAN_PREFIX.length)));
  if (!sameScope(plan.scope, job.scope) || plan.anchorOperationId !== job.operationId) throw Error('CORE2_IMAGE_PLAN_BINDING');
  return plan;
}
