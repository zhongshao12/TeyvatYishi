import type { CoreScope, SourceRef } from '../contracts/identity';
import type { JobRecord, MemorySettings } from '../contracts/memory';
import type { StateRecord } from '../contracts/state';
import { isCoreJsonData, validateCoreDto } from '../contracts/validation';
import { sameScope, stableJson, sameData } from '../persistence/repositoryValidation';
import { coreMomentReplyIdentity } from '../settlement/momentRules';
import { freezeCoreSummarySettings } from './summaryPlan';

export interface CoreMomentPlan {
  version: 1; scope: CoreScope; channelId: string; npcId: string; postVersion: number;
  postSourceRef: SourceRef; postOperationId: string; replyOperationId: string; outputSourceRef: SourceRef;
  modelIdentity: string; summarySettings: MemorySettings;
}
export const CORE_MOMENT_PLAN_PREFIX = 'core2-moment-plan-v1:';
export function serializeCoreMomentPlan(plan: CoreMomentPlan): string { return CORE_MOMENT_PLAN_PREFIX + stableJson(ownPlan(plan)); }
function ownPlan(value: CoreMomentPlan): CoreMomentPlan {
  if (!isCoreJsonData(value) || !value || value.version !== 1 || !validateCoreDto('scope', value.scope).ok
    || Object.keys(value).length !== 11 || !Object.keys(value).every(key => ['version', 'scope', 'channelId', 'npcId', 'postVersion', 'postSourceRef', 'postOperationId', 'replyOperationId', 'outputSourceRef', 'modelIdentity', 'summarySettings'].includes(key))
    || !validateCoreDto('sourceRef', value.postSourceRef).ok || !validateCoreDto('sourceRef', value.outputSourceRef).ok
    || ![value.channelId, value.npcId, value.postOperationId, value.replyOperationId].every(id => validateCoreDto('sourceRef', { sourceId: id, sourceVersion: 1 }).ok)
    || !Number.isSafeInteger(value.postVersion) || value.postVersion < 1 || typeof value.modelIdentity !== 'string' || !value.modelIdentity.trim() || value.modelIdentity.length > 2000) throw Error('CORE2_MOMENT_PLAN_INVALID');
  return { ...structuredClone(value), summarySettings: freezeCoreSummarySettings(value.summarySettings) };
}
export function readCoreMomentPlan(job: JobRecord): CoreMomentPlan {
  if (job.kind !== 'courier' || !job.configFingerprint.startsWith(CORE_MOMENT_PLAN_PREFIX)) throw Error('CORE2_MOMENT_PLAN_UNSUPPORTED');
  const plan = ownPlan(JSON.parse(job.configFingerprint.slice(CORE_MOMENT_PLAN_PREFIX.length)));
  if (!sameScope(job.scope, plan.scope) || job.operationId !== plan.postOperationId || !job.sourceRefs.some(ref => sameData(ref, plan.postSourceRef))) throw Error('CORE2_MOMENT_PLAN_BINDING');
  return plan;
}
export function buildCoreMomentJobs(input: { post: StateRecord<'courier'>; sessionId: string; operationId: string; modelIdentity: string; settings: MemorySettings }): JobRecord[] {
  const post = input.post;
  if (post.value.kind !== 'moment') throw Error('CORE2_MOMENT_NOT_FOUND');
  const postSourceRef = post.value.sourceRef;
  return (post.value.commentNpcIds ?? []).map(npcId => {
    const identity = coreMomentReplyIdentity(post.scope, post.entityId, postSourceRef, npcId);
    const plan = ownPlan({ version: 1, scope: post.scope, channelId: post.entityId, npcId, postVersion: post.version, postSourceRef,
      postOperationId: input.operationId, replyOperationId: identity.operationId, outputSourceRef: { sourceId: identity.sourceId, sourceVersion: 1 }, modelIdentity: input.modelIdentity, summarySettings: input.settings });
    return { jobId: identity.jobId, scope: post.scope, sessionId: input.sessionId, kind: 'courier', operationId: input.operationId, sourceRefs: [postSourceRef], status: 'pending', leaseId: null,
      configFingerprint: serializeCoreMomentPlan(plan), attempts: 0, steps: [], version: 1 };
  });
}
