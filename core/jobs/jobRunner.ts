import type { CoreScope } from '../contracts/identity';
import type { CoreRepository } from '../contracts/storage';
import type { DerivedReceipt, JobRecord, JobStepResult, MemoryRecord } from '../contracts/memory';
import { sameScope } from '../persistence/repositoryValidation';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';

export interface CoreJobRunInput { scope: CoreScope; sessionId: string; jobId: string; signal?: AbortSignal }
export interface CoreJobContext { job: JobRecord; signal: AbortSignal }
export interface CoreJobStep { stepId: string; run(context: CoreJobContext): Promise<MemoryRecord[]> }
export interface CoreJobHandler { steps: CoreJobStep[]; fingerprint?: string; finalize?: (context: CoreJobContext, steps: JobStepResult[]) => Promise<DerivedReceipt | void> }
export interface CoreJobDependencies { repo: CoreRepository; handlers: Partial<Record<JobRecord['kind'], CoreJobHandler>>; getActiveSession?: () => { scope: CoreScope; sessionId: string } | null }
export type JobRunResult = { kind: 'completed' | 'failed' | 'cancelled' | 'conflict'; jobId: string; detail?: string };
export async function readCoreJob(repo: CoreRepository, scope: CoreScope, jobId: string): Promise<JobRecord | null> {
  const head = await repo.readHead(scope);
  return (await repo.queryJobs({ scope, cutoffSeq: head.coreSeq, jobIds: [jobId], limit: 1 })).items.find(row => row.jobId === jobId) ?? null;
}
/** Explicit recovery follows durable same-branch attempts, not a stale button ID. */
export async function readCurrentCoreJobAttempt(repo: CoreRepository, scope: CoreScope, jobId: string): Promise<JobRecord | null> {
  const seen = new Set<string>(); let previous: string | undefined;
  while (true) {
    if (seen.has(jobId) || seen.size >= 1000) throw Error('CORE2_JOB_RETRY_CHAIN_INVALID');
    seen.add(jobId);
    const job = await readCoreJob(repo, scope, jobId);
    if (!job) { if (previous) throw Error('CORE2_JOB_RETRY_CHAIN_INVALID'); return null; }
    if (previous && job.retryOfJobId !== previous) throw Error('CORE2_JOB_RETRY_CHAIN_INVALID');
    if (!job.retriedByJobId) return job;
    previous = jobId; jobId = job.retriedByJobId;
  }
}
export async function runCoreJob(input: CoreJobRunInput, deps: CoreJobDependencies): Promise<JobRunResult> {
  input = { ...input, scope: structuredClone(input.scope) };
  const scope = structuredClone(input.scope), abort = new AbortController(), { repo } = deps;
  const upstream = () => abort.abort(input.signal?.reason); input.signal?.addEventListener('abort', upstream, { once: true }); if (input.signal?.aborted) upstream();
  const result = (kind: JobRunResult['kind'], detail?: string): JobRunResult => ({ kind, jobId: input.jobId, ...(detail ? { detail } : {}) });
  const current = async () => {
    const head = await repo.readHead(scope), active = deps.getActiveSession?.();
    return !abort.signal.aborted && head.sessionId === input.sessionId && (!deps.getActiveSession || !!active && sameScope(active.scope, scope) && active.sessionId === input.sessionId);
  };
  const completePublished = async (saved: JobRecord): Promise<JobRunResult> => {
    if (saved.status === 'completed') return result('completed');
    if (saved.status === 'cancelled' || !await current()) return result('completed', '记忆已发布，未再次调用模型；任务状态需重新查看。');
    const owned = saved.status === 'running' && saved.sessionId === input.sessionId && saved.leaseId ? saved
      : await repo.claimJob({ scope, sessionId: input.sessionId, jobId: saved.jobId, leaseId: crypto.randomUUID(), sourceRefs: saved.sourceRefs, expectedVersion: saved.version });
    if (owned?.leaseId) {
      try { await repo.finishJob({ scope, sessionId: input.sessionId, jobId: owned.jobId, leaseId: owned.leaseId, sourceRefs: owned.sourceRefs, expectedVersion: owned.version, status: 'completed' }); }
      catch { return result('completed', '记忆已发布，完成标记尚待恢复；不会重新生成。'); }
    }
    return result('completed');
  };
  let job: JobRecord | null = null, publicationConflict = false;
  try {
    job = await readCoreJob(repo, scope, input.jobId);
    if (!job) return result('failed', '找不到任务。');
    if (job.publicationReceipt?.status === 'published') return completePublished(job);
    if (job.status === 'completed') return result('completed');
    if (job.status === 'cancelled') return result('cancelled');
    if (!await current()) { if (abort.signal.aborted) { await repo.cancelJob(scope, input.jobId); return result('cancelled'); } return result('conflict', '存档已切换，任务没有继续。'); }
    const handler = deps.handlers[job.kind];
    if (!handler || !handler.steps.length || new Set(handler.steps.map(step => step.stepId)).size !== handler.steps.length) return result('failed', '任务步骤未注册或重复。');
    if (handler.fingerprint && handler.fingerprint !== job.configFingerprint) return result('conflict', '整理规则已变更，请重新建立任务，旧步骤不会混用。');
    const leaseId = crypto.randomUUID();
    job = await repo.claimJob({ scope, sessionId: input.sessionId, jobId: job.jobId, leaseId, sourceRefs: job.sourceRefs, expectedVersion: job.version });
    if (!job) return result('conflict', '同类任务正在执行或持有资格已改变。');
    for (const step of handler.steps) {
      if ((await readCoreJob(repo, scope, input.jobId))?.status === 'cancelled') return result('cancelled');
      if (job.steps.some(saved => saved.stepId === step.stepId && saved.status === 'completed')) continue;
      if (!await current()) break;
      try {
        const memories = await step.run({ job: structuredClone(job), signal: abort.signal });
        if ((await readCoreJob(repo, scope, input.jobId))?.status === 'cancelled') return result('cancelled');
        if (!await current()) break;
        await repo.saveJobStep({ scope, sessionId: input.sessionId, jobId: job.jobId, leaseId, sourceRefs: job.sourceRefs, stepId: step.stepId, status: 'completed', memories });
      } catch (error) {
        if (!await current()) break;
        const detail = sanitizeApiErrorReportText(error instanceof Error ? error.message : String(error));
        await repo.saveJobStep({ scope, sessionId: input.sessionId, jobId: job.jobId, leaseId, sourceRefs: job.sourceRefs, stepId: step.stepId, status: 'failed', memories: [], failure: { code: 'CORE2_JOB_STEP_FAILED', detail } });
        throw Error(detail);
      }
      job = (await readCoreJob(repo, scope, input.jobId))!;
    }
    if (!await current()) { if (abort.signal.aborted) { await repo.cancelJob(scope, input.jobId); return result('cancelled'); } return result('conflict', '存档已切换，迟到结果没有发布。'); }
    if ((await readCoreJob(repo, scope, input.jobId))?.status === 'cancelled') return result('cancelled');
    if (!handler.finalize && job.steps.some(step => step.memories.length)) throw Error('记忆尚未发布，不能将整理任务标为完成。');
    const published = await handler.finalize?.({ job: structuredClone(job), signal: abort.signal }, structuredClone(job.steps));
    if (job.steps.some(step => step.memories.length)) {
      const durable = await readCoreJob(repo, scope, input.jobId);
      if (durable?.publicationReceipt?.status === 'published') return completePublished(durable);
      if (!published) throw Error('记忆结果没有持久发布回执，不能标为完成。');
    }
    if (published?.status === 'cancelled') { await repo.cancelJob(scope, input.jobId); return result('cancelled', published.reason); }
    if (published?.status === 'conflict') { publicationConflict = true; throw Error(published.reason ?? '整理来源已改变，请重新核对。'); }
    if (!await current()) return result(abort.signal.aborted ? 'cancelled' : 'conflict', '完成结果需重新核对。');
    job = (await readCoreJob(repo, scope, input.jobId))!;
    await repo.finishJob({ scope, sessionId: input.sessionId, jobId: job.jobId, leaseId, sourceRefs: job.sourceRefs, expectedVersion: job.version, status: 'completed' });
    return result('completed');
  } catch (error) {
    const durable = await readCoreJob(repo, scope, input.jobId);
    if (durable?.publicationReceipt?.status === 'published') return completePublished(durable);
    if (durable?.status === 'completed') return result('completed');
    if (durable?.status === 'cancelled') return result('cancelled');
    if (abort.signal.aborted) { await repo.cancelJob(scope, input.jobId); return result('cancelled'); }
    const detail = sanitizeApiErrorReportText(error instanceof Error ? error.message : String(error));
    if (job?.leaseId && await current()) {
      const latest = await readCoreJob(repo, scope, input.jobId);
      if (latest?.leaseId === job.leaseId && latest.status === 'running') await repo.finishJob({ scope, sessionId: input.sessionId, jobId: latest.jobId, leaseId: latest.leaseId, sourceRefs: latest.sourceRefs, expectedVersion: latest.version, status: 'failed', failure: { code: 'CORE2_JOB_FAILED', detail } });
    }
    return result(await current() && !publicationConflict ? 'failed' : 'conflict', detail);
  } finally { input.signal?.removeEventListener('abort', upstream); }
}
