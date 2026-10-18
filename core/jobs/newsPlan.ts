import type { CoreScope, SourceRef } from '../contracts/identity';
import type { JobRecord } from '../contracts/memory';
import { isCoreJsonData, validateCoreDto } from '../contracts/validation';
import { sameScope, stableJson } from '../persistence/repositoryValidation';
import { checksumUtf8 } from '../sources/sourceIntegrity';
export const CORE_NEWS_PLAN_PREFIX = 'core2-news-plan-v1:';
export interface CoreNewsPlan { version: 1; scope: CoreScope; anchorOperationId: string; publicationOperationId: string; issueId: string; outputSourceRef: SourceRef; modelIdentity: string }
function own(plan: CoreNewsPlan): CoreNewsPlan {
  if (!isCoreJsonData(plan) || !plan || Object.keys(plan).length !== 7 || !Object.keys(plan).every(key => ['version', 'scope', 'anchorOperationId', 'publicationOperationId', 'issueId', 'outputSourceRef', 'modelIdentity'].includes(key))
    || plan.version !== 1 || !validateCoreDto('scope', plan.scope).ok || !validateCoreDto('sourceRef', plan.outputSourceRef).ok || plan.outputSourceRef.sourceVersion !== 1
    || ![plan.anchorOperationId, plan.publicationOperationId, plan.issueId].every(id => validateCoreDto('sourceRef', { sourceId: id, sourceVersion: 1 }).ok)
    || typeof plan.modelIdentity !== 'string' || !plan.modelIdentity.trim() || plan.modelIdentity.length > 2000) throw Error('CORE2_NEWS_PLAN_INVALID');
  return structuredClone(plan);
}
export function serializeCoreNewsPlan(plan: CoreNewsPlan): string { return CORE_NEWS_PLAN_PREFIX + stableJson(own(plan)); }
export function readCoreNewsPlan(job: JobRecord): CoreNewsPlan {
  if (job.kind !== 'news' || !job.configFingerprint.startsWith(CORE_NEWS_PLAN_PREFIX)) throw Error('CORE2_NEWS_PLAN_UNSUPPORTED');
  const plan = own(JSON.parse(job.configFingerprint.slice(CORE_NEWS_PLAN_PREFIX.length)));
  if (!sameScope(plan.scope, job.scope) || plan.anchorOperationId !== job.operationId) throw Error('CORE2_NEWS_PLAN_BINDING');
  return plan;
}
export function buildCoreNewsJob(input: { scope: CoreScope; operationId: string; sessionId: string; sourceRefs: SourceRef[]; modelIdentity: string }): JobRecord {
  const key = checksumUtf8(stableJson([input.scope, input.operationId]));
  const configFingerprint = serializeCoreNewsPlan({ version: 1, scope: input.scope, anchorOperationId: input.operationId, publicationOperationId: 'news-publication-' + key, issueId: 'issue-' + key,
    outputSourceRef: { sourceId: 'news-output-' + key, sourceVersion: 1 }, modelIdentity: input.modelIdentity });
  return { jobId: 'news-job-' + key, scope: input.scope, sessionId: input.sessionId, kind: 'news', operationId: input.operationId, sourceRefs: input.sourceRefs,
    status: 'pending', leaseId: null, configFingerprint, attempts: 0, steps: [], version: 1 };
}
