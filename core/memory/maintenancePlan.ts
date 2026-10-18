import type { CoreScope, MemoryReadRef, SourceRef } from '../contracts/identity';
import type { MemoryRecord, MemorySettings } from '../contracts/memory';
import type { OperationRecord } from '../contracts/operation';
import type { GameEvent } from '../contracts/event';
import { isCoreJsonData, validateCoreDto } from '../contracts/validation';
import { sourceRefKey, stableJson } from '../persistence/repositoryValidation';

export interface MaintenanceStep { stepId: string; kind: 'turn' | 'layer'; layer: 'short' | 'middle' | 'long'; memoryRefs: MemoryReadRef[]; operationId?: string }
export interface MaintenancePlan { version: 1; scope: CoreScope; sessionId: string; jobId: string; cutoffSeq: number; memoryRevision: number; anchorOperationId: string; mode: 'compress' | 'rebuild'; settings: MemorySettings; steps: MaintenanceStep[]; readSet: MemoryReadRef[]; supersededIds: string[]; sourceRefs: SourceRef[]; reuseJobId?: string }
export interface MaintenanceInput extends Omit<MaintenancePlan, 'version' | 'steps' | 'readSet' | 'supersededIds' | 'sourceRefs'> { memories: MemoryRecord[]; turns: { operation: OperationRecord; completion: GameEvent }[]; selectedTurns?: number[] }
export const PLAN_PREFIX = 'core2-memory-plan-v1:';
const technicalId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,159}$/.test(value);
const nat = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function ownMemoryPlan(plan: MaintenancePlan): MaintenancePlan {
  if (!isCoreJsonData(plan) || !validateCoreDto('scope', plan.scope).ok || !Object.keys(plan).every(key => ['version', 'scope', 'sessionId', 'jobId', 'cutoffSeq', 'memoryRevision', 'anchorOperationId', 'mode', 'settings', 'steps', 'readSet', 'supersededIds', 'sourceRefs', 'reuseJobId'].includes(key))
    || plan.version !== 1 || !technicalId(plan.sessionId) || !technicalId(plan.jobId) || !technicalId(plan.anchorOperationId) || !nat(plan.cutoffSeq) || !nat(plan.memoryRevision) || !['compress', 'rebuild'].includes(plan.mode)
    || !plan.settings || !Object.keys(plan.settings).every(key => ['shortThreshold', 'middleThreshold', 'longThreshold', 'prompt', 'mode'].includes(key)) || !['local', 'model'].includes(plan.settings.mode) || typeof plan.settings.prompt !== 'string'
    || ![plan.settings.shortThreshold, plan.settings.middleThreshold, plan.settings.longThreshold].every(value => Number.isSafeInteger(value) && value >= 2)
    || !Array.isArray(plan.sourceRefs) || plan.sourceRefs.some(ref => !validateCoreDto('sourceRef', ref).ok) || new Set(plan.sourceRefs.map(sourceRefKey)).size !== plan.sourceRefs.length
    || !Array.isArray(plan.readSet) || plan.readSet.some(ref => !technicalId(ref.memoryId) || !nat(ref.version) || ref.version < 1 || Object.keys(ref).some(key => !['memoryId', 'version'].includes(key))) || new Set(plan.readSet.map(ref => ref.memoryId)).size !== plan.readSet.length
    || !Array.isArray(plan.supersededIds) || plan.supersededIds.some(id => !plan.readSet.some(ref => ref.memoryId === id)) || new Set(plan.supersededIds).size !== plan.supersededIds.length
    || !Array.isArray(plan.steps) || new Set(plan.steps.map(step => step.stepId)).size !== plan.steps.length
    || plan.steps.some(step => !technicalId(step.stepId) || !['short', 'middle', 'long'].includes(step.layer) || !Array.isArray(step.memoryRefs) || Object.keys(step).some(key => !['stepId', 'kind', 'layer', 'memoryRefs', 'operationId'].includes(key))
      || step.memoryRefs.some(ref => !plan.readSet.some(read => read.memoryId === ref.memoryId && read.version === ref.version))
      || (plan.mode === 'compress' ? step.kind !== 'layer' || step.memoryRefs.length < 2 || step.operationId !== undefined : step.kind !== 'turn' || step.memoryRefs.length !== 0 || !technicalId(step.operationId)))
    || plan.reuseJobId !== undefined && !technicalId(plan.reuseJobId)) throw Error('CORE2_MEMORY_PLAN_INVALID');
  return structuredClone(plan);
}
/** Full frozen configuration, not a weak hash used as permission. No API credentials enter it. */
export function serializeMemoryPlan(input: MaintenancePlan): string {
  const { jobId: _job, sessionId: _session, reuseJobId: _reuse, ...configuration } = ownMemoryPlan(input);
  return PLAN_PREFIX + stableJson(configuration);
}
export function restoreMemoryPlan(value: string, identity: Pick<MaintenancePlan, 'jobId' | 'sessionId'>): MaintenancePlan {
  if (!value.startsWith(PLAN_PREFIX)) throw Error('CORE2_MEMORY_PLAN_NOT_FOUND');
  return ownMemoryPlan({ ...JSON.parse(value.slice(PLAN_PREFIX.length)), ...identity });
}
