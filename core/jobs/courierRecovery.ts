import type { JobRecord } from '../contracts/memory';
import type { CoreRepository } from '../contracts/storage';
import { readCorePhonePlan, serializeCorePhonePlan } from './phonePlan';
import { CORE_MOMENT_PLAN_PREFIX, readCoreMomentPlan, serializeCoreMomentPlan } from './momentPlan';
import { readCoreJob } from './jobRunner';
import { CORE_PROACTIVE_PLAN_PREFIX, readCoreProactivePlan, serializeCoreProactivePlan } from './proactivePlan';

/** An explicit retry may establish a new attempt; automatic recovery never does. */
export async function prepareCoreCourierRetry(repo: CoreRepository, job: JobRecord, sessionId: string, modelIdentity: string): Promise<string> {
  const visited = new Set<string>();
  while (true) {
    if (visited.has(job.jobId) || visited.size >= 1000) throw Error('CORE2_JOB_RETRY_CHAIN_INVALID');
    visited.add(job.jobId);
    const live = await readCoreJob(repo, job.scope, job.jobId);
    if (!live) throw Error('CORE2_JOB_NOT_FOUND');
    job = live;
    if (!job.retriedByJobId) break;
    const next = await readCoreJob(repo, job.scope, job.retriedByJobId);
    if (!next || next.retryOfJobId !== job.jobId) throw Error('CORE2_JOB_RETRY_CHAIN_INVALID');
    job = next;
  }
  if (job.status === 'completed') return job.jobId;
  const moment = job.configFingerprint.startsWith(CORE_MOMENT_PLAN_PREFIX), proactive = job.configFingerprint.startsWith(CORE_PROACTIVE_PLAN_PREFIX);
  const plan = moment ? readCoreMomentPlan(job) : proactive ? readCoreProactivePlan(job) : readCorePhonePlan(job);
  const staged = await repo.readSource(plan.outputSourceRef);
  if (job.status !== 'cancelled' && (plan.modelIdentity === modelIdentity || staged)) return job.jobId;
  if (job.status === 'running') throw Error('旧配置的回信任务仍在运行，请先停止该任务再重试。');
  // Keep the logical reply operation and frozen output reference. Any acknowledged
  // body is reused; the core transaction prevents a second message/affinity effect.
  const next = { ...job, jobId: `courier-retry-${crypto.randomUUID()}`, sessionId, status: 'pending' as const, leaseId: null, version: 1, attempts: 0, steps: [],
    retryOfJobId: job.jobId,
    configFingerprint: proactive ? serializeCoreProactivePlan({ ...readCoreProactivePlan(job), modelIdentity: staged ? plan.modelIdentity : modelIdentity }) : moment ? serializeCoreMomentPlan({ ...readCoreMomentPlan(job), modelIdentity: staged ? plan.modelIdentity : modelIdentity })
      : serializeCorePhonePlan({ ...readCorePhonePlan(job), modelIdentity: staged ? plan.modelIdentity : modelIdentity }) };
  delete next.failure; delete next.publicationReceipt; delete next.retriedByJobId;
  if (job.status !== 'cancelled') await repo.cancelJob(job.scope, job.jobId);
  try { await repo.enqueueJob(next); return next.jobId; }
  catch (error) {
    const live = await readCoreJob(repo, job.scope, job.jobId);
    if (live?.retriedByJobId || live?.status === 'completed') return prepareCoreCourierRetry(repo, live, sessionId, modelIdentity);
    throw error;
  }
}
