import type { CoreScope } from '../contracts/identity';
import type { JobRecord, MemoryRecord, MemorySettings } from '../contracts/memory';
import type { CoreRepository, Page } from '../contracts/storage';
import type { GameEvent } from '../contracts/event';
import type { OperationRecord } from '../contracts/operation';
import { sameData, sameScope } from '../persistence/repositoryValidation';
import { planMemoryMaintenance, type MaintenancePlan } from './maintenance';
import { restoreMemoryPlan } from './maintenancePlan';
import type { CoreJobDependencies } from '../jobs/jobRunner';

export interface CoreMaintenanceSelection { scope: CoreScope; sessionId: string; mode: 'compress' | 'rebuild'; selectedMemoryIds: string[]; settings: MemorySettings; signal?: AbortSignal }
/** Explicit preparation action only. No provider requests, no history replacement. */
export async function prepareCoreMaintenance(input: CoreMaintenanceSelection, deps: { repo: CoreRepository; getActiveSession?: CoreJobDependencies['getActiveSession'] }) {
  const { signal } = input, owned = structuredClone({ ...input, signal: undefined }), { repo } = deps;
  const guard = async () => {
    if (signal?.aborted) throw Error('CORE2_MAINTENANCE_PREVIEW_CANCELLED');
    const head = await repo.readHead(owned.scope), active = deps.getActiveSession?.();
    if (head.sessionId !== owned.sessionId || deps.getActiveSession && (!active || !sameScope(active.scope, owned.scope) || active.sessionId !== owned.sessionId)) throw Error('CORE2_MAINTENANCE_PREVIEW_SESSION_CHANGED');
    return head;
  };
  const head = await guard(), base = { scope: owned.scope, cutoffSeq: head.coreSeq };
  async function all<T>(read: (cursor?: string) => Promise<Page<T>>): Promise<T[]> {
    const rows: T[] = []; let cursor: string | undefined;
    do { if (signal?.aborted) throw Error('CORE2_MAINTENANCE_PREVIEW_CANCELLED'); const page = await read(cursor); rows.push(...page.items); cursor = page.nextCursor; } while (cursor);
    return rows;
  }
  const memories = await all(cursor => repo.queryMemories({ ...base, memoryRevision: head.memoryRevision, statuses: ['active'], limit: 50, ...(cursor ? { cursor } : {}) }));
  const selected = memories.filter(memory => owned.selectedMemoryIds.includes(memory.memoryId));
  if (owned.mode === 'rebuild' && (!owned.selectedMemoryIds.length || [...new Set(owned.selectedMemoryIds)].some(id => !selected.some(memory => memory.memoryId === id)))) throw Error('CORE2_MAINTENANCE_SELECTION_MISSING');
  const selectedTurns = [...new Set(selected.flatMap(memory => memory.turns))].sort((a, b) => a - b), turns: { operation: OperationRecord; completion: GameEvent }[] = [];
  if (owned.mode === 'rebuild') for (let offset = 0; offset < selectedTurns.length; offset += 50) {
    const events = await all(cursor => repo.queryEvents({ ...base, types: ['turn.complete'], turns: selectedTurns.slice(offset, offset + 50), limit: 50, ...(cursor ? { cursor } : {}) }));
    for (const completion of events) {
      const operation = await repo.readOperation(owned.scope, completion.operationId); if (!operation) throw Error('CORE2_MAINTENANCE_OPERATION_MISSING');
      turns.push({ operation, completion });
    }
  }
  const anchor = (await repo.queryCommittedOperations({ ...base, afterSeq: Math.max(0, head.coreSeq - 1), limit: 50 })).items.at(-1);
  const plan = planMemoryMaintenance({ scope: owned.scope, sessionId: owned.sessionId, mode: owned.mode, settings: owned.settings, memories, turns,
    ...(owned.mode === 'rebuild' ? { selectedTurns } : {}), cutoffSeq: head.coreSeq, memoryRevision: head.memoryRevision, jobId: `memory-job-${crypto.randomUUID()}`, anchorOperationId: anchor?.operationId ?? 'initialization' });
  await guard();
  const replacing = new Set(plan.readSet.map(ref => ref.memoryId)), previewMemories: MemoryRecord[] = memories.filter(memory => replacing.has(memory.memoryId));
  const sourceTurns = owned.mode === 'rebuild' ? selectedTurns : [...new Set(previewMemories.flatMap(memory => memory.turns))].sort((a, b) => a - b);
  return { plan, turns: sourceTurns, modelRequests: plan.settings.mode === 'model' ? plan.steps.length : 0,
    description: plan.steps.length ? `按已冻结的来源整理 ${sourceTurns.length} 个实际回合，原始记录和未选中内容保留。` : '尚未达到各层整理阈值，不会创建任务或调用模型。' };
}
export function restoreBoundMaintenancePlan(job: JobRecord, sessionId: string): MaintenancePlan {
  const plan = restoreMemoryPlan(job.configFingerprint, { jobId: job.jobId, sessionId });
  if (!sameScope(plan.scope, job.scope) || plan.anchorOperationId !== job.operationId || !sameData(plan.sourceRefs, job.sourceRefs)
    || job.kind !== (plan.mode === 'compress' ? 'compression' : 'rebuild')) throw Error('CORE2_MAINTENANCE_JOB_BINDING');
  return plan;
}
