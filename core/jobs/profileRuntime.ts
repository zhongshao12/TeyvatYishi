import type { CoreScope } from '../contracts/identity';
import type { JobRunResult } from './jobRunner';
import { readCurrentCoreJobAttempt } from './jobRunner';
import { runCoreProfileJob, type CoreProfileDependencies } from './profileJob';
import { CORE_PROFILE_PREFIX, readCoreProfilePlan } from './profilePlan';
import { stableJson } from '../persistence/repositoryValidation';

export function createCoreProfileRuntime(deps: CoreProfileDependencies & { onChange(): Promise<void> }) {
  const pending = new Map<string, { abort: AbortController; work: Promise<JobRunResult> }>(); let queue: Promise<unknown> = Promise.resolve();
  const runtime = {
    run(scope: CoreScope, sessionId: string, jobId: string): Promise<JobRunResult> {
      const key = JSON.stringify([scope, jobId]), previous = pending.get(key); if (previous) return previous.work;
      const abort = new AbortController(), work = queue.catch(() => undefined).then(async () => { try { return await runCoreProfileJob({ scope: structuredClone(scope), sessionId, jobId, signal: abort.signal }, deps); } finally { await deps.onChange().catch(() => undefined); } });
      pending.set(key, { abort, work }); queue = work; void work.finally(() => { if (pending.get(key)?.work === work) pending.delete(key); }).catch(() => undefined); return work;
    },
    async retry(scope: CoreScope, sessionId: string, jobId: string): Promise<JobRunResult> {
      const job = await readCurrentCoreJobAttempt(deps.repo, scope, jobId); if (!job || job.kind !== 'profile') throw Error('CORE2_PROFILE_JOB_MISSING');
      if (job.status === 'completed') return { kind: 'completed', jobId: job.jobId };
      const plan = readCoreProfilePlan(job), publication = await deps.repo.readOperation(scope, plan.publicationOperationId);
      const snapshot = await deps.repo.readState(scope);
      const stale = publication?.status === 'prepared' && publication.readSet.some(ref => (snapshot.records.find(row => row.domain === ref.domain && row.entityId === ref.entityId)?.version ?? 0) !== ref.version);
      if (job.status === 'cancelled' || job.status === 'failed' && stale) {
        if (job.status !== 'cancelled') await deps.repo.cancelJob(scope, job.jobId);
        // A sealed operation is immutable. An explicit retry gets a fresh local
        // catalog read/publication, rather than rebasing that old transaction.
        const attempt = crypto.randomUUID();
        const next = { ...job, jobId: `profile-retry-${attempt}`, sessionId, status: 'pending' as const, leaseId: null, version: 1, attempts: 0, steps: [], retryOfJobId: job.jobId,
          configFingerprint: CORE_PROFILE_PREFIX + stableJson({ ...plan, publicationOperationId: `profile-publish-${attempt}`, outputSourceRef: { sourceId: `profile-output-${attempt}`, sourceVersion: 1 } }) }; delete next.failure; delete next.retriedByJobId; delete next.publicationReceipt;
        try { await deps.repo.enqueueJob(next); } catch (error) { const winner = await readCurrentCoreJobAttempt(deps.repo, scope, job.jobId); if (!winner || winner.jobId === job.jobId) throw error; return runtime.run(scope, sessionId, winner.jobId); }
        return runtime.run(scope, sessionId, next.jobId);
      }
      return runtime.run(scope, sessionId, job.jobId);
    },
    async stop(scope: CoreScope, jobId: string) { pending.get(JSON.stringify([scope, jobId]))?.abort.abort(); await deps.repo.cancelJob(scope, jobId); await deps.onChange(); },
    cancelAll() { for (const row of pending.values()) row.abort.abort(); },
    async wait() { while (pending.size) await Promise.allSettled([...pending.values()].map(row => row.work)); },
  }; return runtime;
}
