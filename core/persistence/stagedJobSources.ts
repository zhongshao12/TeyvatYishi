import type { SourceRecord } from '../contracts/event';
import type { JobRecord } from '../contracts/memory';
import { isCoreJsonData } from '../contracts/validation';
import { sameData, sameScope } from './repositoryValidation';
import { readCoreImagePlan } from '../jobs/imagePlan';
import { readCoreProfilePlan } from '../jobs/profilePlan';

/** Only a registered, same-branch job can retain its one uncommitted output.
 * Retaining it grants no fact/knowledge authority; final delivery still validates
 * the complete task plan and the source must enter its own core transaction. */
export function isRegisteredStagedJobSource(source: SourceRecord, job: JobRecord): boolean {
  if (job.kind === 'profile' && source.kind === 'content') {
    try { const plan = readCoreProfilePlan(job); return sameData(source.scope, job.scope) && sameData(source.ref, plan.outputSourceRef) && source.operationId === plan.publicationOperationId && source.blocks.length === 1 && source.blocks[0]?.kind === 'content' && !source.blocks[0].speakerId; } catch { return false; }
  }
  if (job.kind === 'image' && source.kind === 'image') {
    try {
      const plan = readCoreImagePlan(job);
      return sameScope(source.scope, job.scope) && sameData(source.ref, plan.outputSourceRef) && source.operationId === plan.publicationOperationId
        && sameData(source.assetRefs, [plan.assetId]) && source.blocks.length === 1 && source.blocks[0]?.kind === 'message' && !source.blocks[0].speakerId;
    } catch { return false; }
  }
  if (job.kind === 'news' && source.kind === 'news' && sameScope(source.scope, job.scope) && source.ref.sourceVersion === 1 && job.configFingerprint.startsWith('core2-news-plan-v1:')) {
    try {
      const plan: unknown = JSON.parse(job.configFingerprint.slice('core2-news-plan-v1:'.length));
      if (!isCoreJsonData(plan) || !plan || typeof plan !== 'object' || Array.isArray(plan)) return false;
      const value = plan as Record<string, unknown>;
      return value.version === 1 && sameData(value.scope, job.scope) && value.anchorOperationId === job.operationId
        && value.publicationOperationId === source.operationId && sameData(value.outputSourceRef, source.ref) && source.blocks.every(block => block.kind === 'message' && !block.speakerId);
    } catch { return false; }
  }
  if (job.kind !== 'courier' || !sameScope(source.scope, job.scope) || source.blocks.length !== 1 || source.ref.sourceVersion !== 1) return false;
  for (const [prefix, anchorField, kind] of [
    ['core2-phone-plan-v1:', 'playerOperationId', 'courier'],
    ['core2-moment-plan-v1:', 'postOperationId', 'moment'],
    ['core2-proactive-plan-v1:', 'anchorOperationId', 'courier'],
  ] as const) {
    if (!job.configFingerprint.startsWith(prefix)) continue;
    try {
      const value: unknown = JSON.parse(job.configFingerprint.slice(prefix.length));
      if (!isCoreJsonData(value) || !value || typeof value !== 'object' || Array.isArray(value)) return false;
      const plan = value as Record<string, unknown>;
      return plan.version === 1 && typeof plan.npcId === 'string' && sameData(plan.scope, job.scope) && plan[anchorField] === job.operationId && source.kind === kind
        && source.operationId === plan.replyOperationId && sameData(source.ref, plan.outputSourceRef)
        && source.blocks[0]!.kind === 'message' && source.blocks[0]!.speakerId === plan.npcId;
    } catch { return false; }
  }
  return false;
}
