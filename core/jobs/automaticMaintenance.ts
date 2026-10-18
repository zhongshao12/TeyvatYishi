import type { CoreRepository } from '../contracts/storage';
import type { MaintenancePlan, MaintenanceStep } from '../memory/maintenancePlan';
import { restoreMemoryPlan, ownMemoryPlan } from '../memory/maintenancePlan';
import { stableJson, sourceRefKey } from '../persistence/repositoryValidation';

const stepIdentity = (plan: MaintenancePlan, step: MaintenanceStep) => stableJson({ mode: plan.mode, settings: plan.settings, kind: step.kind, layer: step.layer,
  memoryRefs: [...step.memoryRefs].sort((a, b) => a.memoryId.localeCompare(b.memoryId) || a.version - b.version), ...(step.operationId ? { operationId: step.operationId } : {}) });

/** A fresh turn is not consent to retry failed/uncertain/explicitly stopped
 * work. Compare the immutable inputs, not the new job ID or latest head.
 * This filter is ONLY used for automatic work; explicit recovery stays usable. */
export async function filterAutomaticMaintenance(input: MaintenancePlan, repo: CoreRepository): Promise<MaintenancePlan> {
  const plan = ownMemoryPlan(input), blocked = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await repo.queryJobs({ scope: plan.scope, cutoffSeq: plan.cutoffSeq, kinds: ['compression'], statuses: ['pending', 'running', 'failed', 'cancelled'], activeAttemptsOnly: true, limit: 50, ...(cursor ? { cursor } : {}) });
    for (const job of page.items) {
      const saved = restoreMemoryPlan(job.configFingerprint, { jobId: job.jobId, sessionId: plan.sessionId });
      for (const step of saved.steps) blocked.add(stepIdentity(saved, step));
    }
    cursor = page.nextCursor;
  } while (cursor);
  const steps = plan.steps.filter(step => !blocked.has(stepIdentity(plan, step)));
  if (steps.length === plan.steps.length) return plan;
  const ids = new Set(steps.flatMap(step => step.memoryRefs.map(ref => ref.memoryId))), readSet = plan.readSet.filter(ref => ids.has(ref.memoryId));
  const refs = new Map<string, MaintenancePlan['sourceRefs'][number]>();
  for (let offset = 0; offset < readSet.length; offset += 50) {
    const selected = readSet.slice(offset, offset + 50), memories = await repo.readMemoryVersions({ scope: plan.scope, cutoffSeq: plan.cutoffSeq, memoryRevision: plan.memoryRevision, refs: selected });
    if (selected.some(ref => !memories.some(row => row.memoryId === ref.memoryId && row.version === ref.version))) throw Error('CORE2_AUTOMATIC_MEMORY_INPUT_MISSING');
    for (const memory of memories) for (const ref of memory.sourceRefs) refs.set(sourceRefKey(ref), ref);
  }
  return ownMemoryPlan({ ...plan, steps, readSet, sourceRefs: [...refs.values()], supersededIds: plan.supersededIds.filter(id => ids.has(id)) });
}
