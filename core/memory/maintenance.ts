import type { CoreRepository } from '../contracts/storage';
import type { MemoryRecord } from '../contracts/memory';
import { validateCoreDto } from '../contracts/validation';
import { sameData, sameScope, sourceRefKey } from '../persistence/repositoryValidation';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { runCoreJob, readCoreJob, type CoreJobDependencies, type CoreJobHandler, type JobRunResult } from '../jobs/jobRunner';
import { ownMemoryPlan, serializeMemoryPlan, type MaintenanceInput, type MaintenancePlan } from './maintenancePlan';
import { planLayerCompression, summarizeCoreLayer } from './layerCompression';
import { planCoreRebuild } from './rebuild';
import { summarizeCoreTurn, type MemoryModelDependencies } from './turnSummary';
import { buildCoreMemory } from './memoryRecords';
import { readCoreTurnMaterial } from './turnMaterial';
export type { MaintenanceInput, MaintenancePlan } from './maintenancePlan';
export { restoreMemoryPlan } from './maintenancePlan';
export interface MaintenanceDependencies extends MemoryModelDependencies { repo: CoreRepository; signal?: AbortSignal; getActiveSession?: CoreJobDependencies['getActiveSession'] }

export function planMemoryMaintenance(input: MaintenanceInput): MaintenancePlan {
  input = structuredClone(input);
  const eligible = input.memories.filter(memory => validateCoreDto('memory', memory).ok && memory.scope.journeyId === input.scope.journeyId && memory.status === 'active' && !memory.pinned && memory.editVersion === 0 && memory.sourceRefs.length > 0);
  const rebuild = input.mode === 'rebuild' ? planCoreRebuild({ ...input, memories: eligible }) : null;
  const steps = rebuild?.steps ?? planLayerCompression(eligible, input.settings);
  const selectedIds = new Set(steps.flatMap(step => step.memoryRefs.map(ref => ref.memoryId)));
  const selected = rebuild?.replaceable ?? eligible.filter(memory => selectedIds.has(memory.memoryId));
  const selectedOperations = input.turns.filter(turn => steps.some(step => step.operationId === turn.operation.operationId));
  const refs = new Map([...selected.flatMap(memory => memory.sourceRefs), ...selectedOperations.flatMap(turn => turn.operation.sourceRefs)].map(ref => [sourceRefKey(ref), ref]));
  return ownMemoryPlan({ version: 1, scope: input.scope, sessionId: input.sessionId, jobId: input.jobId, cutoffSeq: input.cutoffSeq, memoryRevision: input.memoryRevision, anchorOperationId: input.anchorOperationId, mode: input.mode, settings: input.settings, steps,
    readSet: selected.map(memory => ({ memoryId: memory.memoryId, version: memory.version })), supersededIds: selected.map(memory => memory.memoryId), sourceRefs: [...refs.values()], ...(input.reuseJobId ? { reuseJobId: input.reuseJobId } : {}) });
}
async function readSelected(plan: MaintenancePlan, refs: MaintenancePlan['readSet'], repo: CoreRepository): Promise<MemoryRecord[]> {
  const memories: MemoryRecord[] = []; let cursor: string | undefined;
  do { const page = await repo.queryMemories({ scope: plan.scope, cutoffSeq: plan.cutoffSeq, memoryRevision: plan.memoryRevision, memoryIds: refs.map(ref => ref.memoryId), limit: 200, ...(cursor ? { cursor } : {}) }); memories.push(...page.items); cursor = page.nextCursor; } while (cursor);
  if (refs.some(ref => !memories.some(memory => memory.memoryId === ref.memoryId && memory.version === ref.version))) throw Error('冻结的记忆版本已不可读取，未覆盖现有记忆。');
  return memories;
}
async function requireUnchangedSelection(plan: MaintenancePlan, repo: CoreRepository): Promise<void> {
  const head = await repo.readHead(plan.scope);
  if (head.sessionId !== plan.sessionId) throw Error('执行页面已改变，请重新预览。');
  for (let offset = 0; offset < plan.readSet.length; offset += 50) {
    const refs = plan.readSet.slice(offset, offset + 50);
    const rows = (await repo.queryMemories({ scope: plan.scope, cutoffSeq: head.coreSeq, memoryRevision: head.memoryRevision, memoryIds: refs.map(ref => ref.memoryId), statuses: ['active'], limit: 50 })).items;
    if (refs.some(ref => !rows.some(row => row.memoryId === ref.memoryId && row.version === ref.version))) throw Error('选中记忆已被修改或整理，请重新预览；尚未再次调用模型。');
  }
}
export async function runMemoryMaintenance(input: MaintenancePlan, deps: MaintenanceDependencies): Promise<JobRunResult> {
  const plan = ownMemoryPlan(input), configuration = serializeMemoryPlan(plan), { repo } = deps;
  if (!plan.steps.length) return { kind: 'completed', jobId: plan.jobId, detail: '未达整理阈值，没有创建任务或调用模型。' };
  const head = await repo.readHead(plan.scope);
  if (head.sessionId !== plan.sessionId || head.coreSeq < plan.cutoffSeq || head.memoryRevision < plan.memoryRevision) return { kind: 'conflict', jobId: plan.jobId, detail: '存档位置或执行页面已改变。' };
  const reusable = plan.reuseJobId ? await readCoreJob(repo, plan.scope, plan.reuseJobId) : null;
  if (reusable && (!sameScope(reusable.scope, plan.scope) || reusable.configFingerprint !== configuration || !sameData(reusable.sourceRefs, plan.sourceRefs))) throw Error('不能复用不同范围、规则或来源的旧步骤。');
  await repo.enqueueJob({ jobId: plan.jobId, scope: plan.scope, sessionId: plan.sessionId, kind: plan.mode === 'compress' ? 'compression' : 'rebuild', sourceRefs: plan.sourceRefs, operationId: plan.anchorOperationId, status: 'pending', leaseId: null, configFingerprint: configuration, attempts: 0, steps: [], version: 1, ...(plan.reuseJobId ? { retryOfJobId: plan.reuseJobId } : {}) });
  const handler: CoreJobHandler = { fingerprint: configuration, steps: plan.steps.map(step => ({ stepId: step.stepId, run: async ({ signal }) => {
    // Check BEFORE a possibly paid call, not only at the final atomic publish.
    // Unrelated appended memories intentionally do not invalidate the plan.
    await requireUnchangedSelection(plan, repo);
    const memoryId = `memory-maintenance-${checksumUtf8(JSON.stringify([plan.scope, plan.jobId, step.stepId]))}`;
    const saved = reusable?.steps.find(saved => saved.stepId === step.stepId && saved.status === 'completed');
    if (saved && saved.memories.length === 1) return [{ ...structuredClone(saved.memories[0]!), memoryId, scope: plan.scope }];
    if (step.kind === 'turn') {
      const material = await readCoreTurnMaterial(repo, { scope: plan.scope, cutoffSeq: plan.cutoffSeq, operationId: step.operationId! });
      const summary = await summarizeCoreTurn({ ...material, mode: plan.settings.mode, prompt: plan.settings.prompt, signal }, deps);
      if (summary.kind === 'failed') throw Error(`${summary.code}: ${summary.detail}`);
      return [{ ...summary.memory, memoryId, scope: plan.scope }];
    }
    const memories = await readSelected(plan, step.memoryRefs, repo);
    const text = await summarizeCoreLayer(memories, step.layer, plan.settings, deps, signal);
    return [buildCoreMemory({ scope: plan.scope, memoryId, text, layer: step.layer, sources: [], events: [], memories, mode: plan.settings.mode })];
  } })), finalize: async ({ job }, steps) => repo.publishDerived({ scope: plan.scope, sessionId: plan.sessionId, jobId: job.jobId, leaseId: job.leaseId!, sourceRefs: plan.sourceRefs, readSet: plan.readSet, expectedMemoryRevision: plan.memoryRevision, additions: steps.flatMap(step => step.memories), supersededIds: plan.supersededIds }) };
  return runCoreJob({ scope: plan.scope, sessionId: plan.sessionId, jobId: plan.jobId, signal: deps.signal }, { repo, getActiveSession: deps.getActiveSession, handlers: { [plan.mode === 'compress' ? 'compression' : 'rebuild']: handler } });
}
