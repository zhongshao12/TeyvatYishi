import type { CoreScope, SourceRef } from '../contracts/identity';
import type { JobRecord } from '../contracts/memory';
import { validateCoreDto, isCoreJsonData } from '../contracts/validation';
import { sameData, stableJson } from '../persistence/repositoryValidation';
import { checksumUtf8 } from '../sources/sourceIntegrity';
export const CORE_PROFILE_PREFIX = 'core2-profile-plan-v1:';
interface CoreProfilePlan { version: 1; scope: CoreScope; anchorOperationId: string; publicationOperationId: string; outputSourceRef: SourceRef; npcId: string }
export function buildCoreProfileJob(input: { scope: CoreScope; sessionId: string; operationId: string; sourceRefs: SourceRef[]; npcId: string }): JobRecord {
  const key = checksumUtf8(stableJson([input.scope, input.operationId, input.npcId]));
  const plan: CoreProfilePlan = { version: 1, scope: input.scope, anchorOperationId: input.operationId, publicationOperationId: `profile-publish-${key}`, outputSourceRef: { sourceId: `profile-output-${key}`, sourceVersion: 1 }, npcId: input.npcId };
  return { scope: input.scope, sessionId: input.sessionId, operationId: input.operationId, sourceRefs: input.sourceRefs, kind: 'profile', jobId: `profile-job-${key}`, status: 'pending', leaseId: null, configFingerprint: CORE_PROFILE_PREFIX + stableJson(plan), attempts: 0, steps: [], version: 1 };
}
export function readCoreProfilePlan(job: JobRecord): CoreProfilePlan {
  if (job.kind !== 'profile' || !job.configFingerprint.startsWith(CORE_PROFILE_PREFIX)) throw Error('CORE2_PROFILE_PLAN_INVALID');
  const value: unknown = JSON.parse(job.configFingerprint.slice(CORE_PROFILE_PREFIX.length));
  if (!isCoreJsonData(value) || !value || typeof value !== 'object' || Array.isArray(value)) throw Error('CORE2_PROFILE_PLAN_INVALID');
  const p = value as CoreProfilePlan;
  if (Object.keys(p).length !== 6 || !Object.keys(p).every(key => ['version', 'scope', 'anchorOperationId', 'publicationOperationId', 'outputSourceRef', 'npcId'].includes(key)) || p.version !== 1 || !sameData(p.scope, job.scope) || p.anchorOperationId !== job.operationId
    || !validateCoreDto('sourceRef', p.outputSourceRef).ok || p.outputSourceRef.sourceVersion !== 1 || [p.npcId, p.anchorOperationId, p.publicationOperationId].some(sourceId => !validateCoreDto('sourceRef', { sourceId, sourceVersion: 1 }).ok)) throw Error('CORE2_PROFILE_PLAN_INVALID');
  return p;
}
