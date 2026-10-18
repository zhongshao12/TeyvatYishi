import type { CoreScope } from '../contracts/identity';
import type { CommitReceipt } from '../contracts/operation';
import { runCorePhoneJob, type CorePhoneJobDependencies } from './phoneJob';
import { readCoreJob, type JobRunResult } from './jobRunner';
import { readCorePhonePlan } from './phonePlan';
import { CORE_MOMENT_PLAN_PREFIX, readCoreMomentPlan } from './momentPlan';
import { runCoreMomentJob } from './momentJob';
import type { SettlementDependencies } from '../settlement/settleOperation';
import { CORE_PROACTIVE_PLAN_PREFIX, readCoreProactivePlan } from './proactivePlan';
import { runCoreProactiveJob } from './proactiveJob';

export function createCorePhoneRuntime(deps: CorePhoneJobDependencies & { getSettlementDependencies?(): Omit<SettlementDependencies, 'repo'>; onChange(): Promise<void>; onCommitted(receipt: CommitReceipt, sessionId: string): void | Promise<void> }) {
  const pending = new Map<string, { abort: AbortController; work: Promise<JobRunResult> }>(), queues = new Map<string, Promise<unknown>>();
  const notify = async () => { try { await deps.onChange(); } catch { /* Detached views do not undo a committed reply. */ } };
  return {
    reply(scope: CoreScope, sessionId: string, jobId: string): Promise<JobRunResult> {
      scope = structuredClone(scope); const key = JSON.stringify([scope, jobId]), scopeKey = JSON.stringify(scope), existing = pending.get(key); if (existing) return existing.work;
      const abort = new AbortController(), previous = queues.get(scopeKey) ?? Promise.resolve();
      const work = previous.catch(() => undefined).then(async () => {
        await notify();
        try {
          const queued = await readCoreJob(deps.repo, scope, jobId), moment = queued?.configFingerprint.startsWith(CORE_MOMENT_PLAN_PREFIX), proactive = queued?.configFingerprint.startsWith(CORE_PROACTIVE_PLAN_PREFIX);
          const context = { ...deps, ...deps.getSettlementDependencies?.(), repo: deps.repo, getActiveSession: deps.getActiveSession };
          const result = await (moment ? runCoreMomentJob : proactive ? runCoreProactiveJob : runCorePhoneJob)({ scope, sessionId, jobId, signal: abort.signal }, context);
          if (result.kind === 'completed') {
            const job = await readCoreJob(deps.repo, scope, jobId), plan = job && (moment ? readCoreMomentPlan(job) : proactive ? readCoreProactivePlan(job) : readCorePhonePlan(job));
            const operation = plan && await deps.repo.readOperation(scope, plan.replyOperationId);
            if (operation?.receipt) await deps.onCommitted(operation.receipt, sessionId);
          }
          return result;
        } finally { await notify(); }
      });
      pending.set(key, { abort, work }); queues.set(scopeKey, work);
      void work.finally(() => { if (pending.get(key)?.work === work) pending.delete(key); if (queues.get(scopeKey) === work) queues.delete(scopeKey); }).catch(() => undefined);
      return work;
    },
    async wait(): Promise<void> { while (pending.size) await Promise.allSettled([...pending.values()].map(row => row.work)); },
    cancelAll(): void { for (const row of pending.values()) row.abort.abort(); },
    async stop(scope: CoreScope, jobId: string): Promise<void> { pending.get(JSON.stringify([scope, jobId]))?.abort.abort(); await deps.repo.cancelJob(scope, jobId); await notify(); },
  };
}
