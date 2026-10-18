import type { CoreRepository } from '../contracts/storage';
import type { CoreScope } from '../contracts/identity';
import type { MemoryModelDependencies } from '../memory/turnSummary';
import type { JobRunResult, CoreJobDependencies } from './jobRunner';
import { readCoreJob } from './jobRunner';
import { runCoreSummaryJob } from './summaryJob';
import type { MemorySettings } from '../contracts/memory';
import { prepareCoreMaintenance } from '../memory/maintenanceEntry';
import { runMemoryMaintenance } from '../memory/maintenance';
import { DEFAULT_CORE_MEMORY_SETTINGS } from './summaryPlan';
import type { MaintenancePlan } from '../memory/maintenancePlan';
import { filterAutomaticMaintenance } from './automaticMaintenance';

export function createCoreMemoryRuntime(deps: { repo: CoreRepository; models: MemoryModelDependencies; getActiveSession: CoreJobDependencies['getActiveSession']; onChange(): Promise<void>; getSettings?(): MemorySettings }) {
  const pending = new Map<string, { abort: AbortController; work: Promise<JobRunResult> }>(), queues = new Map<string, Promise<unknown>>();
  const activeMaintenance = new Map<string, AbortController>();
  const notify = async () => { try { await deps.onChange(); } catch { /* Detached views do not own durable job results. */ } };
  return {
    maintain(input: MaintenancePlan): Promise<JobRunResult> {
      const plan = structuredClone(input), key = JSON.stringify([plan.scope, plan.jobId]), scopeKey = JSON.stringify(plan.scope), existing = pending.get(key);
      if (existing) return existing.work;
      const abort = new AbortController(), previous = queues.get(scopeKey) ?? Promise.resolve();
      const work = previous.catch(() => undefined).then(async () => {
        await notify();
        try { return await runMemoryMaintenance(plan, { repo: deps.repo, ...deps.models, getActiveSession: deps.getActiveSession, signal: abort.signal }); }
        finally { await notify(); }
      });
      pending.set(key, { abort, work }); queues.set(scopeKey, work);
      void work.finally(() => { if (pending.get(key)?.work === work) pending.delete(key); if (queues.get(scopeKey) === work) queues.delete(scopeKey); }).catch(() => undefined);
      return work;
    },
    summarize(scope: CoreScope, sessionId: string, jobId: string): Promise<JobRunResult> {
      scope = structuredClone(scope); const key = JSON.stringify([scope, jobId]), scopeKey = JSON.stringify(scope), existing = pending.get(key); if (existing) return existing.work;
      const abort = new AbortController(), previous = queues.get(scopeKey) ?? Promise.resolve();
      const work = previous.catch(() => undefined).then(async () => {
        await notify();
        try {
          const previousJob = await readCoreJob(deps.repo,scope,jobId), newlyRun = previousJob?.status!=='completed' && previousJob?.publicationReceipt?.status!=='published';
          const result = await runCoreSummaryJob({ scope, sessionId, jobId, signal: abort.signal }, { repo: deps.repo, ...deps.models, getActiveSession: deps.getActiveSession });
          if (result.kind !== 'completed' || !newlyRun) return result;
          // Planning stays INSIDE this branch's queue. A following turn cannot
          // prepare a duplicate compression plan before this one is published.
          for (let round = 0; round < 64; round++) {
            const selected = await prepareCoreMaintenance({ scope, sessionId, mode: 'compress', selectedMemoryIds: [], settings: deps.getSettings?.() ?? DEFAULT_CORE_MEMORY_SETTINGS }, deps);
            const plan = await filterAutomaticMaintenance(selected.plan, deps.repo);
            if (!plan.steps.length) break;
            const childKey = JSON.stringify([scope, plan.jobId]), child = new AbortController(); activeMaintenance.set(childKey, child);
            try {
              await notify();
              const compressed = await runMemoryMaintenance(plan, { repo: deps.repo, ...deps.models, getActiveSession: deps.getActiveSession, signal: child.signal });
              if (compressed.kind !== 'completed') break;
            } finally { activeMaintenance.delete(childKey); await notify(); }
          }
          return result;
        }
        finally { await notify(); }
      });
      pending.set(key, { abort, work }); queues.set(scopeKey, work);
      void work.finally(() => { if (pending.get(key)?.work === work) pending.delete(key); if (queues.get(scopeKey) === work) queues.delete(scopeKey); }).catch(() => undefined);
      return work;
    },
    async wait(): Promise<void> { while (pending.size) await Promise.allSettled([...pending.values()].map(row => row.work)); },
    cancelAll(): void { for (const row of pending.values()) row.abort.abort(); for (const abort of activeMaintenance.values()) abort.abort(); },
    async stop(scope: CoreScope, jobId: string): Promise<void> { const key=JSON.stringify([scope,jobId]); pending.get(key)?.abort.abort(); activeMaintenance.get(key)?.abort(); await deps.repo.cancelJob(scope, jobId); await notify(); },
  };
}
