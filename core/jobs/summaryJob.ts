import type { CoreJobRunInput, CoreJobDependencies, JobRunResult } from './jobRunner';
import { readCoreJob, runCoreJob } from './jobRunner';
import { readCoreSummaryPlan } from './summaryPlan';
import { readCoreTurnMaterial } from '../memory/turnMaterial';
import { summarizeCoreTurn, type MemoryModelDependencies } from '../memory/turnSummary';
import { sameData, stableJson } from '../persistence/repositoryValidation';
import { checksumUtf8 } from '../sources/sourceIntegrity';

export async function runCoreSummaryJob(input: CoreJobRunInput, deps: Pick<CoreJobDependencies, 'repo' | 'getActiveSession'> & MemoryModelDependencies): Promise<JobRunResult> {
  const job = await readCoreJob(deps.repo, input.scope, input.jobId);
  if (!job || job.kind !== 'turn_summary') return { kind: 'failed', jobId: input.jobId, detail: '这不是可执行的逐回合摘要任务。' };
  const head = await deps.repo.readHead(input.scope);
  return runCoreJob(input, { ...deps, handlers: { turn_summary: { fingerprint: job.configFingerprint, steps: [{ stepId: 'turn-summary-v1', run: async context => {
    const plan = readCoreSummaryPlan(context.job), material = await readCoreTurnMaterial(deps.repo, { scope: context.job.scope, cutoffSeq: head.coreSeq, operationId: context.job.operationId });
    if (!sameData(material.operation.sourceRefs, context.job.sourceRefs)) throw Error('CORE2_SUMMARY_JOB_SOURCE_MISMATCH');
    const result = await summarizeCoreTurn({ ...material, mode: plan.settings.mode, prompt: plan.settings.prompt, signal: context.signal }, deps);
    if (result.kind !== 'staged') throw Error(`${result.code}: ${result.detail}`);
    return [{ ...result.memory, scope: context.job.scope, memoryId: `memory-turn-${checksumUtf8(stableJson([context.job.scope, context.job.operationId]))}` }];
  } }], finalize: async ({ job: owned }, steps) => deps.repo.publishDerived({ scope: owned.scope, sessionId: input.sessionId, jobId: owned.jobId, leaseId: owned.leaseId!, sourceRefs: owned.sourceRefs,
    readSet: [], expectedMemoryRevision: head.memoryRevision, additions: steps.flatMap(step => step.memories), supersededIds: [] }) } } });
}
