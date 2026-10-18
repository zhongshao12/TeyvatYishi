import type { CoreScope } from '../contracts/identity';
import type { JobRunResult } from './jobRunner';
import { readCurrentCoreJobAttempt } from './jobRunner';
import { readCoreImagePlan, serializeCoreImagePlan } from './imagePlan';
import { runCoreImageJob, type CoreImageDependencies } from './imageJob';
import { sameScope } from '../persistence/repositoryValidation';

export function createCoreImageRuntime(deps: CoreImageDependencies & { onChange(): Promise<void>; onCommitted(scope: CoreScope, sessionId: string): Promise<void> }) {
  const pending = new Map<string, { abort: AbortController; work: Promise<JobRunResult> }>(); let queue: Promise<unknown> = Promise.resolve();
  const notify = async () => { try { await deps.onChange(); } catch { /* A detached view cannot undo saved bytes. */ } };
  const runtime = {
    run(scope: CoreScope, sessionId: string, jobId: string): Promise<JobRunResult> {
      scope = structuredClone(scope); const key = JSON.stringify([scope, jobId]), existing = pending.get(key); if (existing) return existing.work;
      const abort = new AbortController(), work = queue.catch(() => undefined).then(async () => {
        try { const result = await runCoreImageJob({ scope, sessionId, jobId, signal: abort.signal }, deps); if (result.kind === 'completed') await deps.onCommitted(scope, sessionId); return result; }
        finally { await notify(); }
      });
      pending.set(key, { abort, work }); queue = work;
      void work.finally(() => { if (pending.get(key)?.work === work) pending.delete(key); }).catch(() => undefined); return work;
    },
    async retry(scope: CoreScope, sessionId: string, jobId: string): Promise<JobRunResult> {
      const job = await readCurrentCoreJobAttempt(deps.repo, scope, jobId); if (!job || job.kind !== 'image') throw Error('CORE2_IMAGE_JOB_MISSING');
      if (!sameScope(job.scope, scope)) throw Error('这是旧分支的图片任务，请在当前分支重新确认生成。');
      if (job.status === 'completed') return { kind: 'completed', jobId: job.jobId };
      const plan = readCoreImagePlan(job), saved = await deps.repo.readAsset(plan.assetId);
      if (job.status === 'cancelled' || !saved && plan.modelIdentity !== deps.models.getModelIdentity()) {
        if (job.status === 'running') throw Error('旧图片任务仍在运行，请先停止。');
        if (job.status !== 'cancelled') await deps.repo.cancelJob(scope, job.jobId);
        const next = { ...job, jobId: 'image-retry-' + crypto.randomUUID(), sessionId, status: 'pending' as const, leaseId: null, version: 1, attempts: 0, steps: [], retryOfJobId: job.jobId,
          configFingerprint: serializeCoreImagePlan({ ...plan, modelIdentity: saved ? plan.modelIdentity : deps.models.getModelIdentity() }) };
        delete next.failure; delete next.publicationReceipt; delete next.retriedByJobId;
        try { await deps.repo.enqueueJob(next); }
        catch (error) {
          const winner = await readCurrentCoreJobAttempt(deps.repo, scope, job.jobId);
          if (!winner || winner.kind !== 'image' || winner.jobId === job.jobId) throw error;
          const bound = readCoreImagePlan(winner); if (bound.anchorOperationId !== plan.anchorOperationId || bound.publicationOperationId !== plan.publicationOperationId) throw error;
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
