import type { CoreScope } from '../contracts/identity';
import type { CoreRepository } from '../contracts/storage';
import type { DerivedReceipt, JobRecord } from '../contracts/memory';
import type { SettlementDependencies } from '../settlement/settleOperation';
import { executeCorePlayerCommand } from '../settlement/reviewActions';
import { readCoreJob, runCoreJob } from '../jobs/jobRunner';
import { stableJson, sourceRefKey, sameData, sameScope } from '../persistence/repositoryValidation';
import { isCoreJsonData, validateCoreDto } from '../contracts/validation';
import type { JobRunResult } from '../jobs/jobRunner';

export interface MemoryEditAction { scope: CoreScope; sessionId: string; operationId: string; jobId: string; memoryId: string; expectedVersion: number; text: string; pinned?: boolean; importance?: number }
const manualPrefix = 'core2-manual-memory-v1:';
export function readCoreManualEditPlan(job: JobRecord): Omit<MemoryEditAction, 'sessionId' | 'jobId'> {
  if (job.kind !== 'manual_memory' || !job.configFingerprint.startsWith(manualPrefix)) throw Error('CORE2_MANUAL_EDIT_PLAN_UNSUPPORTED');
  const plan = JSON.parse(job.configFingerprint.slice(manualPrefix.length));
  if (!isCoreJsonData(plan) || !plan || typeof plan !== 'object' || Array.isArray(plan) || Object.keys(plan).length !== 3
    || !validateCoreDto('scope', plan.scope).ok || !sameScope(plan.scope, job.scope) || plan.operationId !== job.operationId) throw Error('CORE2_MANUAL_EDIT_PLAN_BINDING');
  const command = plan.command;
  if (!command || typeof command !== 'object' || Array.isArray(command) || command.type !== 'memory_edit'
    || !Object.keys(command).every(key => ['type', 'memoryId', 'expectedVersion', 'text', 'pinned', 'importance'].includes(key))
    || !validateCoreDto('sourceRef', { sourceId: command.memoryId, sourceVersion: 1 }).ok || !Number.isSafeInteger(command.expectedVersion) || command.expectedVersion < 1
    || typeof command.text !== 'string' || !command.text.trim() || command.pinned !== undefined && typeof command.pinned !== 'boolean'
    || command.importance !== undefined && (typeof command.importance !== 'number' || !Number.isFinite(command.importance) || command.importance < 0)) throw Error('CORE2_MANUAL_EDIT_PLAN_INVALID');
  return { scope: structuredClone(plan.scope), operationId: plan.operationId, memoryId: command.memoryId, expectedVersion: command.expectedVersion, text: command.text, ...(command.pinned === undefined ? {} : { pinned: command.pinned }), ...(command.importance === undefined ? {} : { importance: command.importance }) };
}
export async function resumeCoreManualEdit(repo: CoreRepository, job: JobRecord, sessionId: string, deps: Omit<SettlementDependencies, 'repo'>): Promise<JobRunResult> {
  const plan = readCoreManualEditPlan(job);
  if (job.publicationReceipt?.status === 'published' || job.status === 'completed') return { kind: 'completed', jobId: job.jobId };
  let jobId = job.jobId;
  if (job.status === 'cancelled') {
    jobId = `memory-edit-retry-${crypto.randomUUID()}`;
    const next = { ...job, jobId, retryOfJobId: job.jobId, sessionId, status: 'pending' as const, leaseId: null, attempts: 0, steps: [], version: 1 };
    delete next.failure; delete next.publicationReceipt; await repo.enqueueJob(next);
  }
  const result = await editCoreMemory(repo, { ...plan, jobId, sessionId }, deps);
  return { kind: result.status === 'published' ? 'completed' : result.status === 'cancelled' ? 'cancelled' : 'conflict', jobId, ...('reason' in result ? { detail: result.reason } : {}) };
}
export async function editCoreMemory(repo: CoreRepository, input: MemoryEditAction, deps: Omit<SettlementDependencies, 'repo'>): Promise<DerivedReceipt> {
  input = structuredClone(input);
  const { scope, sessionId, operationId, jobId, memoryId, expectedVersion, text } = input;
  if (!text.trim() || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw Error('记忆内容不能为空，版本必须有效。');
  const command = { type: 'memory_edit' as const, memoryId, expectedVersion, text, ...(input.pinned === undefined ? {} : { pinned: input.pinned }), ...(input.importance === undefined ? {} : { importance: input.importance }) };
  const fingerprint = manualPrefix + stableJson({ scope, operationId, command });
  const existingJob = await readCoreJob(repo, scope, jobId);
  if (existingJob && existingJob.configFingerprint !== fingerprint) throw Error('同一编辑任务不能换成另一份内容。');
  if (existingJob?.publicationReceipt?.status === 'published') return existingJob.publicationReceipt;
  const head = await repo.readHead(scope);
  if (head.sessionId !== sessionId) throw Error('CORE2_SESSION_CHANGED');
  const memory = (await repo.queryMemories({ scope, cutoffSeq: head.coreSeq, memoryRevision: head.memoryRevision, memoryIds: [memoryId] })).items[0];
  if (!memory || memory.version !== expectedVersion) throw Error('记忆已被修改，请重新打开编辑，未覆盖新内容。');
  if (!existingJob) {
    const committed = await executeCorePlayerCommand(repo, { scope, sessionId, operationId, command }, deps);
    if (!['committed', 'already_committed'].includes(committed.status)) return { status: 'cancelled', memoryRevision: head.memoryRevision, memoryIds: [], reason: '编辑请求没有提交。' };
  }
  const operation = (await repo.readOperation(scope, operationId))!;
  if (!operation?.receipt || !['committed', 'already_committed'].includes(operation.receipt.status) || operation.kind !== 'manual' || operation.sourceRefs.length !== 1) throw Error('CORE2_MANUAL_EDIT_OPERATION_MISSING');
  const source = operation.sourceRefs[0]!;
  if (existingJob) {
    const original = await repo.readSource(source), recorded = original?.kind === 'manual' && original.blocks.length === 1 ? JSON.parse(original.blocks[0]!.text) : null;
    // The original command body is immutable, including after package ID remapping.
    // Validate content and the typed job/source graph; never rewrite historical JSON.
    if (!recorded || recorded.type !== 'memory_edit' || recorded.expectedVersion !== expectedVersion || recorded.text !== text || recorded.pinned !== input.pinned || recorded.importance !== input.importance
      || !existingJob.sourceRefs.some(ref => sameData(ref, source)) || !memory.sourceRefs.every(ref => existingJob.sourceRefs.some(item => sameData(item, ref)))) throw Error('CORE2_MANUAL_EDIT_SOURCE_MISMATCH');
  }
  const refs = new Map([...memory.sourceRefs, source].map(ref => [sourceRefKey(ref), ref]));
  const edited = { ...structuredClone(memory), scope, version: memory.version + 1, text: text.trim(), editVersion: memory.editVersion + 1, pinned: input.pinned ?? memory.pinned, importance: input.importance ?? memory.importance, sourceRefs: [...refs.values()], memoryRefs: [{ memoryId, version: expectedVersion }], momentRange: { ...memory.momentRange, sourceIds: [...new Set([...memory.momentRange.sourceIds, source.sourceId])] }, generation: { mode: 'manual' as const, version: 'core2-memory-v1' } };
  if (!existingJob) await repo.enqueueJob({ jobId, scope, sessionId, kind: 'manual_memory', operationId, sourceRefs: [...refs.values()], status: 'pending', leaseId: null, configFingerprint: fingerprint, attempts: 0, steps: [], version: 1 });
  const result = await runCoreJob({ scope, sessionId, jobId }, { repo, getActiveSession: deps.getActiveSession, handlers: { manual_memory: { fingerprint, steps: [{ stepId: 'manual-edit', run: async () => [edited] }], finalize: async ({ job }, steps) => repo.publishDerived({ scope, sessionId, jobId, leaseId: job.leaseId!, sourceRefs: job.sourceRefs, readSet: [{ memoryId, version: expectedVersion }], expectedMemoryRevision: head.memoryRevision, additions: steps.flatMap(step => step.memories), supersededIds: [] }) } } });
  const durable = await readCoreJob(repo, scope, jobId);
  return durable?.publicationReceipt ?? { status: result.kind === 'cancelled' ? 'cancelled' : 'conflict', memoryRevision: (await repo.readHead(scope)).memoryRevision, memoryIds: [], reason: result.detail ?? '编辑没有发布。' };
}
