import type { CoreScope } from '../contracts/identity';
import type { JobRunResult } from './jobRunner';
import { readCurrentCoreJobAttempt } from './jobRunner';
import { readCoreNewsPlan, serializeCoreNewsPlan } from './newsPlan';
import { runCoreNewsJob, type CoreNewsDependencies } from './newsJob';

export function createCoreNewsRuntime(deps: CoreNewsDependencies & { onChange(): Promise<void>; onCommitted(scope: CoreScope, sessionId: string): Promise<void> }) {
  const pending = new Map<string, { abort: AbortController; work: Promise<JobRunResult> }>(); let queue: Promise<unknown> = Promise.resolve();
  const notify = async () => { try { await deps.onChange(); } catch { /* Detached UI cannot undo a saved issue. */ } };
  const runtime = {
    run(scope: CoreScope, sessionId: string, jobId: string): Promise<JobRunResult> {
      scope = structuredClone(scope); const key = JSON.stringify([scope, jobId]), previous = pending.get(key); if (previous) return previous.work;
      const abort = new AbortController(), work = queue.catch(() => undefined).then(async () => {
        try { const result = await runCoreNewsJob({ scope, sessionId, jobId, signal: abort.signal }, deps); if (result.kind === 'completed') await deps.onCommitted(scope, sessionId); return result; }
        finally { await notify(); }
      });
      pending.set(key, { abort, work }); queue = work;
      void work.finally(() => { if (pending.get(key)?.work === work) pending.delete(key); }).catch(() => undefined); return work;
    },
    async retry(scope: CoreScope, sessionId: string, jobId: string) {
      const job = await readCurrentCoreJobAttempt(deps.repo, scope, jobId); if (!job || job.kind !== 'news') throw Error('CORE2_NEWS_JOB_MISSING');
      if (job.status === 'completed') return { kind: 'completed' as const, jobId: job.jobId };
      const plan = readCoreNewsPlan(job), saved = await deps.repo.readSource(plan.outputSourceRef);
      if (job.status === 'cancelled' || !saved && plan.modelIdentity !== deps.models.getModelIdentity()) {
        if (job.status === 'running') throw Error('旧简报任务仍在运行，请先停止。');
        if (job.status !== 'cancelled') await deps.repo.cancelJob(scope, job.jobId);
        const next = { ...job, jobId: 'news-retry-' + crypto.randomUUID(), sessionId, status: 'pending' as const, leaseId: null, version: 1, attempts: 0, steps: [], retryOfJobId: job.jobId,
          configFingerprint: serializeCoreNewsPlan({ ...plan, modelIdentity: saved ? plan.modelIdentity : deps.models.getModelIdentity() }) };
        delete next.failure; delete next.publicationReceipt; delete next.retriedByJobId;
        try { await deps.repo.enqueueJob(next); }
        catch (error) {
          const winner = await readCurrentCoreJobAttempt(deps.repo, scope, job.jobId);
          if (!winner || winner.kind !== 'news' || winner.jobId === job.jobId) throw error;
          const bound = readCoreNewsPlan(winner);
          if (bound.anchorOperationId !== plan.anchorOperationId || bound.publicationOperationId !== plan.publicationOperationId) throw error;
          return runtime.run(scope, sessionId, winner.jobId);
        }
        return runtime.run(scope, sessionId, next.jobId);
      }
      return runtime.run(scope, sessionId, job.jobId);
    },
    async stop(scope: CoreScope, jobId: string) { pending.get(JSON.stringify([scope, jobId]))?.abort.abort(); await deps.repo.cancelJob(scope, jobId); await notify(); },
    cancelAll() { for (const row of pending.values()) row.abort.abort(); },
    async wait() { while (pending.size) await Promise.allSettled([...pending.values()].map(row => row.work)); },
  };
  return runtime;
}
