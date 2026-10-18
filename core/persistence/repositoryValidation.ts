import { isCoreJsonData, validateCoreDto } from '../contracts/validation';
import type { CoreDtoKind, CoreDtoTypes } from '../contracts/validation';
import type { CoreScope, RecordRef, SourceRef } from '../contracts/identity';
import type { CoreQuery, MemoryQuery } from '../contracts/storage';
import type { PreparedCommit, OperationRecord } from '../contracts/operation';

export function ownDto<K extends CoreDtoKind>(kind: K, value: CoreDtoTypes[K]): CoreDtoTypes[K] {
  if (!validateCoreDto(kind, value).ok) throw new Error(`CORE2_INVALID_${kind.toUpperCase()}`);
  return structuredClone(value);
}
export function assertId(value: string): void {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,159}$/.test(value)) throw new Error('CORE2_INVALID_ID');
}
export function sameScope(a: CoreScope, b: CoreScope): boolean {
  return a.journeyId === b.journeyId && a.branchId === b.branchId;
}
export function scopeKey(scope: CoreScope): string[] { return [scope.journeyId, scope.branchId]; }
export function sourceKey(ref: SourceRef): [string, number] { return [ref.sourceId, ref.sourceVersion]; }
export function recordKey(scope: CoreScope, ref: RecordRef): string[] { return [...scopeKey(scope), ref.domain, ref.entityId]; }
export function refKey(ref: RecordRef): string { return `${ref.domain}:${ref.entityId}`; }
export function sourceRefKey(ref: SourceRef): string { return `${ref.sourceId}:${ref.sourceVersion}`; }

/** Equality of inert DTO data, independent of object property insertion order. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => sameData(item, b[index]));
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const left = Object.keys(a), right = Object.keys(b);
    return left.length === right.length && left.every(key => Object.hasOwn(b, key) && sameData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }
  return false;
}
export function unique<T>(items: readonly T[], key: (item: T) => string): boolean { return new Set(items.map(key)).size === items.length; }
/** A model request starts as a captured draft. Only a staged draft may bind effects once. */
export function preparationConflict(previous: OperationRecord, next: OperationRecord): boolean {
  if (previous.kind !== next.kind || !sameData(previous.sourceRefs, next.sourceRefs) || next.attempts < previous.attempts) return true;
  const sealing = (previous.status === 'draft' || previous.status === 'failed' && previous.effects.length === 0) && next.status === 'prepared';
  if (sealing) return !previous.stage || next.readSet.some(ref => {
    const captured = previous.readSet.find(value => refKey(value) === refKey(ref));
    return captured ? captured.version !== ref.version : ref.version !== 0;
  });
  return previous.status === 'prepared' && next.status === 'draft' || !sameData(previous.readSet, next.readSet) || !sameData(previous.effects, next.effects);
}
/** Technical IDs are ASCII; their persisted order must not depend on host locale. */
export function compareCoreIds(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

export function stableJson(value: unknown): string {
  if (!isCoreJsonData(value)) throw new Error('CORE2_INVALID_JSON');
  const encode = (item: unknown): string => {
    if (item === null || typeof item !== 'object') return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(encode).join(',')}]`;
    const object = item as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${encode(object[key])}`).join(',')}}`;
  };
  return encode(value);
}

export function commitShapeConflict(batch: PreparedCommit): string | null {
  if (!unique(batch.readSet, refKey) || !unique(batch.sourceRefs, sourceRefKey) ||
    !unique(batch.changes, change => refKey(change.ref)) || !unique(batch.changes, change => change.effectKey) ||
    !unique(batch.events, event => event.eventId) || !unique(batch.knowledge, row => row.knowledgeId) ||
    !unique(batch.commitments, row => row.commitmentId) || !unique(batch.jobs, job => job.jobId)) return 'duplicate_identity';
  const reads = new Map(batch.readSet.map(ref => [refKey(ref), ref.version]));
  for (const change of batch.changes) {
    if (reads.get(refKey(change.ref)) !== change.ref.version) return 'write_not_in_read_set';
    for (const record of [change.before, change.after]) {
      if (record && (!sameScope(record.scope, batch.scope) || refKey(record) !== refKey(change.ref))) return 'change_identity_mismatch';
    }
    if (change.before && change.before.version !== change.ref.version) return 'before_version_mismatch';
    if (change.after && change.after.version !== change.ref.version + 1) return 'after_version_mismatch';
  }
  const eventChanges = batch.events.flatMap(event => event.committedChanges);
  if (eventChanges.length !== batch.changes.length || !unique(eventChanges, change => change.effectKey)) return 'event_change_mismatch';
  const attributed = new Map(eventChanges.map(change => [change.effectKey, change]));
  if (batch.changes.some(change => !sameData(change, attributed.get(change.effectKey)))) return 'event_change_mismatch';
  if (batch.events.some(event => event.operationId !== batch.operationId || event.journeyId !== batch.scope.journeyId || event.branchId !== batch.scope.branchId)) return 'event_identity_mismatch';
  if (batch.jobs.some(job => job.publicationReceipt !== undefined || job.retryOfJobId !== undefined || job.retriedByJobId !== undefined || job.operationId !== batch.operationId || job.sessionId !== batch.sessionId || job.status !== 'pending' || job.leaseId !== null || job.version !== 1 || job.steps.length !== 0)) return 'job_identity_mismatch';
  return null;
}

export function ownQuery<Q extends CoreQuery>(query: Q, filterKeys: readonly string[]): Q {
  if (!isCoreJsonData(query) || !query || typeof query !== 'object' || Array.isArray(query)) throw new Error('CORE2_INVALID_QUERY');
  ownDto('scope', query.scope);
  const keys = new Set(['scope', 'cutoffSeq', 'cursor', 'limit', ...filterKeys]);
  if (!Object.keys(query).every(key => keys.has(key)) || !Number.isSafeInteger(query.cutoffSeq) || query.cutoffSeq < 0 ||
    (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 200)) ||
    (query.cursor !== undefined && (typeof query.cursor !== 'string' || query.cursor.length > 1000))) throw new Error('CORE2_INVALID_QUERY');
  for (const key of filterKeys) {
    const value = (query as unknown as Record<string, unknown>)[key];
    if (key === 'activeAttemptsOnly') { if (value !== undefined && typeof value !== 'boolean') throw Error('CORE2_INVALID_QUERY'); continue; }
    if(key==='direction') { if(value!==undefined && value!=='asc' && value!=='desc') throw Error('CORE2_INVALID_QUERY'); continue; }
    if(key==='afterSeq') {if(value!==undefined && (!Number.isSafeInteger(value) || (value as number)<0 || (value as number)>query.cutoffSeq)) throw new Error('CORE2_INVALID_QUERY');continue;}
    if (value !== undefined && (!Array.isArray(value) || !value.every(item => key === 'turns'
      ? typeof item === 'number' && Number.isSafeInteger(item) && item >= 0
      : typeof item === 'string' && item.trim().length > 0))) throw new Error('CORE2_INVALID_QUERY');
  }
  return structuredClone(query);
}

export function ownMemoryQuery(input: MemoryQuery): MemoryQuery {
  if (!isCoreJsonData(input) || !input || typeof input !== 'object') throw new Error('CORE2_INVALID_QUERY');
  const { memoryRevision,afterRevision, ...query } = input;
  if (!Number.isSafeInteger(memoryRevision) || memoryRevision < 0) throw new Error('CORE2_INVALID_QUERY');
  if(afterRevision!==undefined && (!Number.isSafeInteger(afterRevision) || afterRevision<0 || afterRevision>memoryRevision)) throw new Error('CORE2_INVALID_QUERY');
  return { ...ownQuery(query, ['memoryIds', 'npcIds', 'layers', 'statuses', 'turns', 'keywords', 'locations']), memoryRevision,...(afterRevision===undefined?{}:{afterRevision}) };
}
