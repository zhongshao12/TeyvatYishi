import type { CoreScope, SourceRef } from '../contracts/identity';
import type { EventDraft } from '../contracts/event';
import type { JobRecord, MemorySettings } from '../contracts/memory';
import { isCoreJsonData, validateCoreDto } from '../contracts/validation';
import { sameScope, stableJson } from '../persistence/repositoryValidation';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { freezeCoreSummarySettings } from './summaryPlan';

export interface CorePhoneResponsePlan { npcIds: string[]; modelIdentity: string }
export interface CorePhonePlan {
  version: 1; scope: CoreScope; target: 'private' | 'group'; channelId: string; npcId: string;
  playerEventId: string; playerOperationId: string; replyOperationId: string; outputSourceRef: SourceRef;
  modelIdentity: string; summarySettings: MemorySettings;
}
export const CORE_PHONE_PLAN_PREFIX = 'core2-phone-plan-v1:';
function ownPhonePlan(value: CorePhonePlan): CorePhonePlan {
  if (!isCoreJsonData(value) || !value || value.version !== 1 || !validateCoreDto('scope', value.scope).ok
    || Object.keys(value).length !== 11 || !Object.keys(value).every(key => ['version', 'scope', 'target', 'channelId', 'npcId', 'playerEventId', 'playerOperationId', 'replyOperationId', 'outputSourceRef', 'modelIdentity', 'summarySettings'].includes(key))
    || !['private', 'group'].includes(value.target) || !validateCoreDto('sourceRef', value.outputSourceRef).ok
    || ![value.channelId, value.npcId, value.playerEventId, value.playerOperationId, value.replyOperationId].every(id => validateCoreDto('sourceRef', { sourceId: id, sourceVersion: 1 }).ok)
    || typeof value.modelIdentity !== 'string' || !value.modelIdentity.trim() || value.modelIdentity.length > 2000) throw Error('CORE2_PHONE_PLAN_INVALID');
  return { ...structuredClone(value), summarySettings: freezeCoreSummarySettings(value.summarySettings) };
}
export function serializeCorePhonePlan(plan: CorePhonePlan): string { return CORE_PHONE_PLAN_PREFIX + stableJson(ownPhonePlan(plan)); }
export function readCorePhonePlan(job: JobRecord): CorePhonePlan {
  if (job.kind !== 'courier' || !job.configFingerprint.startsWith(CORE_PHONE_PLAN_PREFIX)) throw Error('CORE2_PHONE_PLAN_UNSUPPORTED');
  const plan = ownPhonePlan(JSON.parse(job.configFingerprint.slice(CORE_PHONE_PLAN_PREFIX.length)));
  if (!sameScope(job.scope, plan.scope) || job.operationId !== plan.playerOperationId) throw Error('CORE2_PHONE_PLAN_BINDING');
  return plan;
}
export function buildCorePhoneJobs(input: { scope: CoreScope; sessionId: string; sourceRefs: SourceRef[]; event: EventDraft; response: CorePhoneResponsePlan; settings: MemorySettings }): JobRecord[] {
  return input.response.npcIds.map(npcId => {
    const key = checksumUtf8(stableJson([input.scope, input.event.eventId, npcId]));
    const plan: CorePhonePlan = { version: 1, scope: input.scope, target: input.event.type === 'communication.private' ? 'private' : 'group', channelId: input.event.channelId!, npcId,
      playerEventId: input.event.eventId, playerOperationId: input.event.operationId, replyOperationId: `phone-reply-${key}`, outputSourceRef: { sourceId: `phone-output-${key}`, sourceVersion: 1 }, modelIdentity: input.response.modelIdentity, summarySettings: input.settings };
    return { jobId: `phone-job-${key}`, scope: input.scope, sessionId: input.sessionId, kind: 'courier', operationId: input.event.operationId, sourceRefs: input.sourceRefs,
      status: 'pending', leaseId: null, configFingerprint: serializeCorePhonePlan(plan), attempts: 0, steps: [], version: 1 };
  });
}
