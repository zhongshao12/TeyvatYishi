import type { BranchHead, CoreScope, SourceRef } from '../contracts/identity';
import type { EvidenceRef, GameEvent, SourceRecord } from '../contracts/event';
import type { CommitmentRecord, KnowledgeRecord } from '../contracts/knowledge';
import type { DerivedPatch, DerivedReceipt, JobClaim, JobFinish, JobRecord, JobStepResult, MemoryRecord } from '../contracts/memory';
import type { CommitReceipt, JourneySeed, OperationRecord, OperationStage, PreparedCommit } from '../contracts/operation';
import type { CoreSnapshot, StateRecord } from '../contracts/state';
import type { CommittedOperationQuery, CoreRepository, CoreQuery, EventQuery, KnowledgeQuery, CommitmentQuery, JobQuery, Page, SnapshotRecord, SaveSlot, ForkRequest, CoreAsset, AssetPublication } from '../contracts/storage';
import { isCoreJsonData, validateCoreDto } from '../contracts/validation';
import { validateEvidence } from '../sources/sourceRecords';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { CORE2_DATABASE_NAME, openCoreDatabase } from './indexedSchema';
import type { CoreStoreName } from './indexedSchema';
import { request, transact } from './indexedTransaction';
import { branch, branchPath, entityVersions, operationForScope, withinPath } from './indexedScope';
import type { StoredBranch } from './indexedScope';
import { ownAsset, ownAssetPublication, sameAsset } from './binaryAssets';
import { createIndexedIndexMethods } from './indexedIndexes';
import type { IndexFaultPoint } from './indexedIndexes';
import { ownCommitmentQuery, dateCommitmentDue } from './commitmentDates';
import { checkpointForState } from './snapshots';
import { createIndexedImportMethods } from './indexedImports';
import { createIndexedExportMethods } from './indexedExports';
import { createIndexedSourceMethods } from './indexedSources';
import { createIndexedOperationSourceMethods } from './indexedOperationSources';
import { sourcePosition } from './sourcePositions';
import { paged } from './pagination';
import { createIndexedMemoryReadMethods } from './indexedMemories';
import { createIndexedJourneyMethods } from './indexedJourneys';
import type { ImportFaultPoint } from './indexedImports';
import { assertId, commitShapeConflict, compareCoreIds, ownDto, ownQuery, preparationConflict, recordKey, refKey, sameData, sameScope, scopeKey, sourceKey, sourceRefKey, stableJson, unique } from './repositoryValidation';

export type RepositoryFaultPoint = 'initialize:states' | 'commit:states' | 'commit:events' | 'commit:knowledge' | 'commit:commitments' | 'commit:jobs' | 'commit:receipt' | 'commit:complete' | 'derived:memories' | 'derived:receipt' | 'snapshot:record' | 'snapshot:slot' | 'fork:head' | 'fork:states' | 'asset:record' | IndexFaultPoint | ImportFaultPoint;
export interface IndexedRepositoryOptions { databaseName?: string; factory?: IDBFactory; fault?: (point: RepositoryFaultPoint) => void }

interface StoredState { scope: CoreScope; domain: StateRecord['domain']; entityId: string; version: number; record: StateRecord | null }
interface StoredSource { record: SourceRecord; commitSeq: number | null }
interface Positioned<T> { scope: CoreScope; commitSeq: number; record: T }
interface StoredKnowledge extends Positioned<KnowledgeRecord> { knowledgeId: string; version: number }
interface StoredCommitment extends Positioned<CommitmentRecord> { commitmentId: string; version: number }
interface StoredMemory extends Positioned<MemoryRecord> { publishedRevision: number }
interface StoredJob extends Positioned<JobRecord> { leaseIds?: string[]; publication?: { leaseId: string; fingerprint: string; descriptor: Omit<DerivedPatch, 'additions'>; receipt: DerivedReceipt } }

function storedState(record: StateRecord): StoredState {
  return { scope: record.scope, domain: record.domain, entityId: record.entityId, version: record.version, record };
}
function snapshotState(current: StoredBranch, states: StoredState[]): CoreSnapshot {
  return { head: current.head, records: states.flatMap(state => state.record ? [state.record] : []), contentRefs: current.contentRefs,
    tombstones: states.filter(state => !state.record).map(state => ({ domain: state.domain, entityId: state.entityId, version: state.version })) };
}
function checkedSnapshot(input: SnapshotRecord): SnapshotRecord {
  const snapshot = ownDto('snapshotRecord', input);
  if (snapshot.checksum !== checksumUtf8(stableJson(snapshot.state))) throw new Error('CORE2_SNAPSHOT_CHECKSUM_MISMATCH');
  const tombstones = snapshot.state.tombstones ?? [];
  if (!unique(snapshot.state.records, refKey) || !unique(tombstones, refKey) ||
    tombstones.some(ref => snapshot.state.records.some(record => refKey(record) === refKey(ref)))) throw new Error('CORE2_INVALID_SNAPSHOT_RECORDS');
  return snapshot;
}
async function sourceIsUsable(tx: IDBTransaction, source: StoredSource | undefined, scope: CoreScope, operationId: string): Promise<boolean> {
  if (!source) return false;
  if (source.commitSeq === null) return sameScope(source.record.scope, scope) && source.record.operationId === operationId;
  return withinPath(await branchPath(tx, scope), source.record.scope, source.commitSeq);
}
function uncommittedReceipt(batch: PreparedCommit, head: BranchHead, status: 'conflict' | 'cancelled', reason: string): CommitReceipt {
  return { status, scope: batch.scope, operationId: batch.operationId, coreSeq: head.coreSeq, eventIds: [], jobIds: [], reason };
}
async function evidenceValid(tx: IDBTransaction, refs: EvidenceRef[], declared: SourceRef[], scope: CoreScope, operationId: string): Promise<boolean> {
  const allowed = new Set(declared.map(sourceRefKey));
  for (const evidence of refs) {
    if (!allowed.has(sourceRefKey(evidence.ref))) return false;
    const source = await request<StoredSource | undefined>(tx.objectStore('sources').get(sourceKey(evidence.ref)));
    if (!source || !await sourceIsUsable(tx, source, scope, operationId) || !validateEvidence(evidence, source.record).ok) return false;
  }
  return true;
}
function intersects<T>(value: readonly T[], filter?: readonly T[]): boolean { return !filter || filter.some(item => value.includes(item)); }

async function sourcesCommitted(tx: IDBTransaction, refs: SourceRef[], head: BranchHead): Promise<boolean> {
  if (!unique(refs, sourceRefKey)) return false;
  const path = await branchPath(tx, head.scope);
  for (const ref of refs) {
    const source = await request<StoredSource | undefined>(tx.objectStore('sources').get(sourceKey(ref)));
    if (!source || source.commitSeq === null || !withinPath(path, source.record.scope, source.commitSeq)) return false;
  }
  return true;
}
async function latestMemory(tx: IDBTransaction, scope: CoreScope, memoryId: string): Promise<StoredMemory | undefined> {
  const versions = await entityVersions<StoredMemory>(tx, 'memories', scope, memoryId);
  return versions.reduce<StoredMemory | undefined>((latest, value) => !latest || latest.record.version < value.record.version ? value : latest, undefined);
}
function holderMatches(job: StoredJob | undefined, head: BranchHead, input: Pick<JobClaim, 'sessionId' | 'leaseId' | 'sourceRefs'>): job is StoredJob {
  return !!job && job.record.status === 'running' && head.sessionId === input.sessionId && job.record.sessionId === input.sessionId &&
    job.record.leaseId === input.leaseId && sameData(job.record.sourceRefs, input.sourceRefs);
}
async function memoryProvenanceValid(tx: IDBTransaction, memories: MemoryRecord[], declared: SourceRef[], head: BranchHead,
  reads: { memoryId: string; version: number }[]): Promise<boolean> {
  const path = await branchPath(tx, head.scope);
  for (const memory of memories) {
    if (memory.sourceRefs.some(ref => !declared.some(source => sameData(source, ref))) || !await sourcesCommitted(tx, memory.sourceRefs, head)) return false;
    for (const eventId of memory.eventIds) {
      const event = await request<GameEvent | undefined>(tx.objectStore('events').get(eventId));
      if (!event || !withinPath(path, { journeyId: event.journeyId, branchId: event.branchId }, event.commitSeq)) return false;
    }
    for (const ref of memory.memoryRefs) {
      if (!reads.some(read => sameData(read, ref))) return false;
      const record = await latestMemory(tx, head.scope, ref.memoryId);
      if (!record || record.record.version !== ref.version) return false;
    }
  }
  return true;
}

export function createIndexedRepository(options: IndexedRepositoryOptions = {}): CoreRepository {
  const name = options.databaseName ?? CORE2_DATABASE_NAME;
  if (options.fault && !name.startsWith('test-core2-')) throw new Error('CORE2_FAULT_INJECTION_TEST_ONLY');
  // Lazy opening keeps initialization DTO ownership synchronous and doesn't open
  // any DB simply by importing the module or constructing the repository.
  let connection: Promise<IDBDatabase> | undefined;
  const database = () => connection ??= openCoreDatabase(name, options.factory);
  const fault = (point: RepositoryFaultPoint) => options.fault?.(point);

  async function readRows<T>(query: CoreQuery, storeName: CoreStoreName): Promise<Positioned<T>[]> {
    const db = await database();
    return transact(db, ['branches', storeName], 'readonly', async tx => {
      const path = await branchPath(tx, query.scope, query.cutoffSeq);
      const rows: Positioned<T>[] = [];
      for (const bound of storeName === 'jobs' ? path.slice(0, 1) : path) {
        const found = await request<Positioned<T>[]>(tx.objectStore(storeName).index('by_scope').getAll(scopeKey(bound.scope)));
        rows.push(...found.filter(row => row.commitSeq <= bound.cutoffSeq));
      }
      return rows;
    });
  }

  return {
    ...createIndexedIndexMethods(database, fault),
    ...createIndexedImportMethods(database, fault),
    ...createIndexedExportMethods(database),
    ...createIndexedSourceMethods(database),
    ...createIndexedOperationSourceMethods(database),
    ...createIndexedMemoryReadMethods(database),
    ...createIndexedJourneyMethods(database),
    async initialize(input: JourneySeed): Promise<BranchHead> {
      const seed = ownDto('seed', input);
      if (seed.head.coreSeq !== 0 || seed.head.memoryRevision !== 0 || seed.head.parent ||
        !unique(seed.records, refKey) || !unique(seed.sources, source => sourceRefKey(source.ref)) ||
        !seed.records.some(record => record.domain === 'traveler' && record.entityId === seed.playerId)) throw new Error('CORE2_INVALID_INITIALIZATION');
      const db = await database();
      return transact(db, ['branches', 'states', 'sources', 'sourcePositions', 'snapshots'], 'readwrite', async tx => {
        if (await request(tx.objectStore('branches').get(scopeKey(seed.head.scope)))) throw new Error('CORE2_BRANCH_EXISTS');
        await request(tx.objectStore('branches').add({ head: seed.head, playerId: seed.playerId, contentRefs: seed.contentRefs,sourceCount:seed.sources.length } satisfies StoredBranch));
        for (const record of seed.records) await request(tx.objectStore('states').add(storedState(record)));
        fault('initialize:states');
        for (const source of seed.sources) {await request(tx.objectStore('sources').add({ record: source, commitSeq: 0 } satisfies StoredSource));await request(tx.objectStore('sourcePositions').add(sourcePosition(source,0)));}
        const current = await branch(tx,seed.head.scope);
        const states = await request<StoredState[]>(tx.objectStore('states').index('by_scope').getAll(scopeKey(seed.head.scope)));
        const initial = checkpointForState(snapshotState(current,states));
        await request(tx.objectStore('snapshots').add(initial));
        await request(tx.objectStore('branches').put({ ...current,checkpointId: initial.snapshotId } satisfies StoredBranch));
        return seed.head;
      });
    },

    async readHead(input: CoreScope): Promise<BranchHead> {
      const scope = ownDto('scope', input), db = await database();
      return transact(db, ['branches'], 'readonly', async tx => (await branch(tx, scope)).head);
    },

    async readRecoveryCheckpoint(input: CoreScope): Promise<SnapshotRecord> {
      const scope = ownDto('scope',input), db = await database();
      return transact(db,['branches','snapshots'],'readonly',async tx=>{
        const current = await branch(tx,scope);
        if (!current.checkpointId) throw new Error('CORE2_CHECKPOINT_NOT_FOUND');
        const raw = await request<SnapshotRecord | undefined>(tx.objectStore('snapshots').get(current.checkpointId));
        if (!raw) throw new Error('CORE2_CHECKPOINT_NOT_FOUND');
        const snapshot = checkedSnapshot(raw);
        if (!sameScope(snapshot.scope,scope) || snapshot.coreSeq > current.head.coreSeq || snapshot.memoryRevision > current.head.memoryRevision) throw new Error('CORE2_CHECKPOINT_POSITION_MISMATCH');
        return snapshot;
      });
    },

    async activateSession(input: CoreScope, sessionId: string): Promise<BranchHead> {
      const scope = ownDto('scope', input); assertId(sessionId);
      const db = await database();
      return transact(db, ['branches'], 'readwrite', async tx => {
        const current = await branch(tx, scope);
        current.head.sessionId = sessionId;
        await request(tx.objectStore('branches').put(current));
        return current.head;
      });
    },

    async readState(input: CoreScope): Promise<CoreSnapshot> {
      const scope = ownDto('scope', input), db = await database();
      return transact(db, ['branches', 'states'], 'readonly', async tx => {
        const current = await branch(tx, scope);
        const states = await request<StoredState[]>(tx.objectStore('states').index('by_scope').getAll(scopeKey(scope)));
        return snapshotState(current, states);
      });
    },

    async putSource(input: SourceRecord): Promise<SourceRef> {
      const source = ownDto('source', input);
      if (!unique(source.blocks, block => block.blockId)) throw new Error('CORE2_DUPLICATE_BLOCK_ID');
      const db = await database();
      return transact(db, ['branches', 'sources', 'sourcePositions'], 'readwrite', async tx => {
        const current=await branch(tx, source.scope);
        const store = tx.objectStore('sources');
        const existing = await request<StoredSource | undefined>(store.get(sourceKey(source.ref)));
        if (existing) {
          if (!sameData(existing.record, source)) throw new Error('CORE2_SOURCE_IMMUTABLE');
          return source.ref;
        }
        if (source.ref.sourceVersion > 1) {
          const previous = await request<StoredSource | undefined>(store.get([source.ref.sourceId, source.ref.sourceVersion - 1]));
          if (!previous || !sameScope(previous.record.scope, source.scope) || previous.record.kind !== source.kind) throw new Error('CORE2_SOURCE_VERSION_CONFLICT');
        }
        await request(store.add({ record: source, commitSeq: null } satisfies StoredSource));
        await request(tx.objectStore('sourcePositions').add(sourcePosition(source,null)));
        await request(tx.objectStore('branches').put({...current,sourceCount:current.sourceCount+1} satisfies StoredBranch));
        return source.ref;
      });
    },

    async readSource(input: SourceRef): Promise<SourceRecord | null> {
      const ref = ownDto('sourceRef', input), db = await database();
      return transact(db, ['sources'], 'readonly', async tx => (await request<StoredSource | undefined>(tx.objectStore('sources').get(sourceKey(ref))))?.record ?? null);
    },

    async prepareOperation(input: OperationRecord): Promise<void> {
      const operation = ownDto('operation', input);
      if (!['draft', 'prepared', 'failed'].includes(operation.status) || operation.receipt || operation.stage ||
        !unique(operation.readSet, refKey) || !unique(operation.sourceRefs, sourceRefKey) || !unique(operation.effects, effect => effect)) throw new Error('CORE2_INVALID_PREPARATION');
      const db = await database();
      await transact(db, ['branches', 'operations', 'sources'], 'readwrite', async tx => {
        await branch(tx, operation.scope);
        const store = tx.objectStore('operations');
        const previous = await operationForScope(tx, operation.scope, operation.operationId);
        if (previous?.status === 'cancelled' || previous?.status === 'committed') throw new Error('CORE2_OPERATION_TERMINAL');
        if (previous && preparationConflict(previous, operation)) throw new Error('CORE2_OPERATION_VERSION_CONFLICT');
        for (const ref of operation.sourceRefs) {
          const source = await request<StoredSource | undefined>(tx.objectStore('sources').get(sourceKey(ref)));
          if (!await sourceIsUsable(tx, source, operation.scope, operation.operationId)) throw new Error('CORE2_SOURCE_NOT_REACHABLE');
        }
        await request(store.put(previous?.stage ? { ...operation, stage: previous.stage } : operation));
      });
    },

    async stageOperation(input: OperationStage): Promise<void> {
      const stage = ownDto('stage', input), db = await database();
      await transact(db, ['branches', 'operations', 'sources'], 'readwrite', async tx => {
        const current = await branch(tx, stage.scope);
        if (current.head.sessionId !== stage.sessionId) throw new Error('CORE2_SESSION_CHANGED');
        const store = tx.objectStore('operations');
        const operation = await request<OperationRecord | undefined>(store.get([...scopeKey(stage.scope), stage.operationId]));
        if (!operation) throw new Error('CORE2_OPERATION_NOT_PREPARED');
        if (operation.status === 'committed' || operation.status === 'cancelled') throw new Error('CORE2_OPERATION_TERMINAL');
        if (!sameData(operation.sourceRefs, stage.sourceRefs) || stage.candidates.some(candidate => candidate.operationId !== stage.operationId) ||
          !unique(stage.candidates, candidate => candidate.candidateId) || !unique(stage.review, review => review.candidateId) ||
          stage.review.some(review => !stage.candidates.some(candidate => candidate.candidateId === review.candidateId))) throw new Error('CORE2_STAGE_IDENTITY_MISMATCH');
        if (operation.stage && (stage.stageVersion < operation.stage.stageVersion ||
          (stage.stageVersion === operation.stage.stageVersion && !sameData(stage, operation.stage)))) throw new Error('CORE2_STAGE_VERSION_CONFLICT');
        for (const candidate of stage.candidates) if (!await evidenceValid(tx, candidate.evidenceRefs, stage.sourceRefs, stage.scope, stage.operationId)) throw new Error('CORE2_INVALID_EVIDENCE');
        await request(store.put({ ...operation, stage }));
      });
    },

    async cancelOperation(input: CoreScope, operationId: string): Promise<void> {
      const scope = ownDto('scope', input); assertId(operationId);
      const db = await database();
      await transact(db, ['branches', 'operations', 'jobs'], 'readwrite', async tx => {
        await branch(tx, scope);
        const store = tx.objectStore('operations'), key = [...scopeKey(scope), operationId];
        const operation = await operationForScope(tx, scope, operationId);
        if (operation?.status === 'committed') {
          const jobs = await request<StoredJob[]>(tx.objectStore('jobs').index('by_operation').getAll([...scopeKey(scope), operationId]));
          for (const job of jobs) if (job.record.status !== 'completed' && job.record.status !== 'cancelled') {
            await request(tx.objectStore('jobs').put({ ...job, record: { ...job.record, status: 'cancelled', leaseId: null, version: job.record.version + 1 } }));
          }
          return;
        }
        await request(store.put(operation ? { ...operation, status: 'cancelled' } :
          { scope, operationId, kind: 'system', status: 'cancelled', sourceRefs: [], readSet: [], candidateRefs: [], effects: [], attempts: 0 } satisfies OperationRecord));
      });
    },

    async readOperation(input: CoreScope, operationId: string): Promise<OperationRecord | null> {
      const scope = ownDto('scope', input); assertId(operationId);
      const db = await database();
      return transact(db, ['branches', 'operations'], 'readonly', async tx => {
        await branch(tx, scope);
        return await operationForScope(tx, scope, operationId) ?? null;
      });
    },

    async commit(input: PreparedCommit): Promise<CommitReceipt> {
      const batch = ownDto('commit', input), db = await database();
      const receipt = await transact(db, ['branches', 'states', 'sources', 'sourcePositions', 'operations', 'events', 'effects', 'knowledge', 'commitments', 'jobs', 'snapshots'], 'readwrite', async tx => {
        const current = await branch(tx, batch.scope);
        const operationStore = tx.objectStore('operations');
        const operation = await operationForScope(tx, batch.scope, batch.operationId);
        if (operation?.status === 'committed' && operation.receipt && ['committed', 'already_committed'].includes(operation.receipt.status)) return { ...operation.receipt, scope: batch.scope, status: 'already_committed' as const };
        const conflict = (reason: string) => uncommittedReceipt(batch, current.head, 'conflict', reason);
        if (current.head.sessionId !== batch.sessionId || operation?.status === 'cancelled') return uncommittedReceipt(batch, current.head, 'cancelled', 'session_changed_or_cancelled');
        if (batch.jobGuard) {
          const guard = batch.jobGuard, stored = await request<StoredJob | undefined>(tx.objectStore('jobs').get([...scopeKey(batch.scope), guard.jobId]));
          if (stored?.record.status === 'cancelled') return uncommittedReceipt(batch, current.head, 'cancelled', 'job_cancelled');
          if (!stored || stored.record.status !== 'running' || stored.record.leaseId !== guard.leaseId || stored.record.sessionId !== batch.sessionId
            || stored.record.version !== guard.expectedVersion || !sameData(stored.record.sourceRefs, guard.sourceRefs)) return conflict('job_lease_changed');
        }
        const shapeConflict = commitShapeConflict(batch);
        if (shapeConflict) return conflict(shapeConflict);
        if (operation?.status !== 'prepared' || !operation.stage || operation.stage.sessionId !== batch.sessionId ||
          !sameData(operation.sourceRefs, batch.sourceRefs) || !sameData(operation.readSet, batch.readSet) ||
          !sameData(operation.effects, batch.changes.map(change => change.effectKey))) return conflict('operation_not_prepared');
        for (const ref of batch.readSet) {
          const state = await request<StoredState | undefined>(tx.objectStore('states').get(recordKey(batch.scope, ref)));
          if ((state?.version ?? 0) !== ref.version) return conflict('state_read_version_changed');
        }
        for (const change of batch.changes) {
          const state = await request<StoredState | undefined>(tx.objectStore('states').get(recordKey(batch.scope, change.ref)));
          if (!sameData(state?.record ?? null, change.before)) return conflict('before_state_mismatch');
          for (const bound of await branchPath(tx, batch.scope)) {
            const effect = await request<{ commitSeq: number } | undefined>(tx.objectStore('effects').get([...scopeKey(bound.scope), change.effectKey]));
            if (effect && effect.commitSeq <= bound.cutoffSeq) return conflict('effect_already_applied');
          }
        }
        for (const ref of batch.sourceRefs) {
          const source = await request<StoredSource | undefined>(tx.objectStore('sources').get(sourceKey(ref)));
          if (!source || !await sourceIsUsable(tx, source, batch.scope, batch.operationId)) return conflict('source_not_reachable');
          if (source.commitSeq === null && await request(tx.objectStore('sources').get([ref.sourceId, ref.sourceVersion + 1]))) return conflict('source_version_changed');
        }
        const eventIds = new Set(batch.events.map(event => event.eventId));
        const eventReachable = async (eventId: string): Promise<boolean> => {
          if (eventIds.has(eventId)) return true;
          const event = await request<GameEvent | undefined>(tx.objectStore('events').get(eventId));
          return !!event && withinPath(await branchPath(tx, batch.scope), { journeyId: event.journeyId, branchId: event.branchId }, event.commitSeq);
        };
        for (const event of batch.events) {
          if (await request(tx.objectStore('events').get(event.eventId))) return conflict('event_identity_exists');
          if (!await evidenceValid(tx, event.evidenceRefs, batch.sourceRefs, batch.scope, batch.operationId)) return conflict('invalid_event_evidence');
          if (event.correctionOf && (eventIds.has(event.correctionOf) || !await eventReachable(event.correctionOf))) return conflict('correction_event_not_reachable');
          if (event.replyToEventId && (eventIds.has(event.replyToEventId) || !await eventReachable(event.replyToEventId))) return conflict('reply_event_not_reachable');
        }
        for (const knowledge of batch.knowledge) {
          if (!await eventReachable(knowledge.eventId) || !await evidenceValid(tx, knowledge.evidenceRefs, batch.sourceRefs, batch.scope, batch.operationId)) return conflict('invalid_knowledge_evidence');
          const previous = await entityVersions<StoredKnowledge>(tx, 'knowledge', batch.scope, knowledge.knowledgeId);
          if (knowledge.version !== Math.max(0, ...previous.map(row => row.version)) + 1) return conflict('knowledge_version_changed');
        }
        for (const commitment of batch.commitments) {
          if (!await eventReachable(commitment.establishedEventId)) return conflict('commitment_event_not_reachable');
          for (const item of commitment.history) if (!await eventReachable(item.eventId)) return conflict('commitment_history_not_reachable');
          const previous = await entityVersions<StoredCommitment>(tx, 'commitments', batch.scope, commitment.commitmentId);
          if (commitment.version !== Math.max(0, ...previous.map(row => row.version)) + 1) return conflict('commitment_version_changed');
        }
        for (const job of batch.jobs) {
          if (await request(tx.objectStore('jobs').get([...scopeKey(batch.scope), job.jobId]))) return conflict('job_identity_exists');
          if (job.sourceRefs.some(ref => !batch.sourceRefs.some(source => sameData(source, ref)))) return conflict('job_source_not_declared');
        }
        // No writes occur until every guard has succeeded. All writes below share one transaction.
        const seq = current.head.coreSeq + 1;
        for (const change of batch.changes) {
          await request(tx.objectStore('states').put({ scope: batch.scope, domain: change.ref.domain, entityId: change.ref.entityId, version: change.ref.version + 1, record: change.after } satisfies StoredState));
          await request(tx.objectStore('effects').add({ scope: batch.scope, effectKey: change.effectKey, operationId: batch.operationId, commitSeq: seq }));
        }
        fault('commit:states');
        for (const event of batch.events) await request(tx.objectStore('events').add({ ...event, commitSeq: seq } satisfies GameEvent));
        fault('commit:events');
        for (const record of batch.knowledge) await request(tx.objectStore('knowledge').add({ scope: batch.scope, knowledgeId: record.knowledgeId, version: record.version, commitSeq: seq, record } satisfies StoredKnowledge));
        fault('commit:knowledge');
        for (const record of batch.commitments) await request(tx.objectStore('commitments').add({ scope: batch.scope, commitmentId: record.commitmentId, version: record.version, commitSeq: seq, record } satisfies StoredCommitment));
        fault('commit:commitments');
        for (const record of batch.jobs) await request(tx.objectStore('jobs').add({ scope: batch.scope, commitSeq: seq, record } satisfies Positioned<JobRecord>));
        fault('commit:jobs');
        for (const ref of batch.sourceRefs) {
          const source = (await request<StoredSource>(tx.objectStore('sources').get(sourceKey(ref))));
          if (source.commitSeq === null) {await request(tx.objectStore('sources').put({ ...source, commitSeq: seq }));await request(tx.objectStore('sourcePositions').put(sourcePosition(source.record,seq)));}
        }
        const saved: CommitReceipt = { status: 'committed', scope: batch.scope, operationId: batch.operationId, coreSeq: seq, eventIds: batch.events.map(event => event.eventId), jobIds: batch.jobs.map(job => job.jobId) };
        await request(operationStore.put({ ...operation, status: 'committed', receipt: saved } satisfies OperationRecord));
        const next: StoredBranch = { ...current, head: { ...current.head, coreSeq: seq } };
        if (seq % 50 === 0) {
          const states = await request<StoredState[]>(tx.objectStore('states').index('by_scope').getAll(scopeKey(batch.scope)));
          const checkpoint = checkpointForState(snapshotState(next,states));
          await request(tx.objectStore('snapshots').add(checkpoint)); next.checkpointId = checkpoint.snapshotId;
        }
        await request(tx.objectStore('branches').put(next));
        fault('commit:receipt');
        return saved;
      });
      if (receipt.status === 'committed') fault('commit:complete');
      return receipt;
    },

    async queryEvents(input: EventQuery): Promise<Page<GameEvent>> {
      const query = ownQuery(input, ['eventIds', 'npcIds', 'types', 'turns', 'locations','afterSeq', 'channelIds', 'direction']), db = await database();
      const events = await transact(db, ['branches', 'events'], 'readonly', async tx => {
        const events: GameEvent[] = [], path = await branchPath(tx, query.scope, query.cutoffSeq);
        if (query.eventIds) {
          const found = await Promise.all([...new Set(query.eventIds)].map(id => request<GameEvent | undefined>(tx.objectStore('events').get(id))));
          return found.filter((event): event is GameEvent => !!event && event.commitSeq > (query.afterSeq ?? 0)
            && withinPath(path, { journeyId: event.journeyId, branchId: event.branchId }, event.commitSeq));
        }
        for (const bound of path) {
          const found = await request<GameEvent[]>(tx.objectStore('events').index('by_scope').getAll(scopeKey(bound.scope)));
          events.push(...found.filter(event => event.commitSeq <= bound.cutoffSeq && event.commitSeq>(query.afterSeq??0)));
        }
        return events;
      });
      const items = events.filter(event => event.commitSeq <= query.cutoffSeq && intersects([event.eventId], query.eventIds) &&
        intersects([...event.actorIds, ...event.targetIds], query.npcIds) && intersects([event.type], query.types) && intersects([event.turn], query.turns) &&
        intersects(event.occurredMoment.location ? [event.occurredMoment.location] : [], query.locations) && intersects(event.channelId ? [event.channelId] : [], query.channelIds)).sort((a, b) => a.commitSeq - b.commitSeq || (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0) || compareCoreIds(a.eventId, b.eventId));
      if(query.direction==='desc') items.reverse();
      return paged(items, query, event => event.eventId);
    },

    async queryCommittedOperations(input: CommittedOperationQuery): Promise<Page<OperationRecord>> {
      const query=ownDto('committedOperationQuery',input);
      if (query.afterSeq>query.cutoffSeq) throw new Error('CORE2_INVALID_QUERY');
      const db=await database();
      const operations=await transact(db,['branches','operations'],'readonly',async tx=>{
        const result: OperationRecord[]=[];
        for (const bound of await branchPath(tx,query.scope,query.cutoffSeq)) {
          const rows=await request<OperationRecord[]>(tx.objectStore('operations').index('by_status').getAll([...scopeKey(bound.scope),'committed']));
          result.push(...rows.filter(row=>row.status==='committed' && row.receipt && row.receipt.coreSeq>query.afterSeq && row.receipt.coreSeq<=bound.cutoffSeq && intersects([row.kind], query.kinds)));
        }
        return result;
      });
      operations.sort((a,b)=>a.receipt!.coreSeq-b.receipt!.coreSeq || compareCoreIds(a.operationId,b.operationId));
      if(query.direction==='desc') operations.reverse();
      return paged(operations,query,row=>row.operationId);
    },

    async queryOperations(input) {
      const query = ownDto('operationQuery', input), db = await database();
      const items = await transact(db, ['branches', 'operations'], 'readonly', async tx => {
        const current = await branch(tx, query.scope);
        if (query.cutoffSeq !== current.head.coreSeq) throw Error('CORE2_OPERATION_VIEW_POSITION');
        const records: OperationRecord[] = [];
        for (const status of [...new Set(query.statuses)]) records.push(...await request<OperationRecord[]>(tx.objectStore('operations').index('by_status').getAll([...scopeKey(query.scope), status])));
        return records.filter(row => intersects([row.kind], query.kinds)).sort((a, b) => compareCoreIds(a.operationId, b.operationId));
      });
      return paged(items, query, row => row.operationId);
    },

    async queryKnowledge(input: KnowledgeQuery): Promise<Page<KnowledgeRecord>> {
      const query = ownQuery(input, ['npcIds', 'eventIds']);
      const rows = await readRows<KnowledgeRecord>(query, 'knowledge');
      const latest = new Map<string, KnowledgeRecord>();
      for (const row of rows) if ((latest.get(row.record.knowledgeId)?.version ?? 0) < row.record.version) latest.set(row.record.knowledgeId, row.record);
      const items = [...latest.values()].filter(row => intersects([row.npcId], query.npcIds) && intersects([row.eventId], query.eventIds)).sort((a, b) => compareCoreIds(a.knowledgeId, b.knowledgeId));
      return paged(items, query, row => row.knowledgeId);
    },

    async queryCommitments(input:CommitmentQuery):Promise<Page<CommitmentRecord>> {
      const query=ownCommitmentQuery(input),rows=await readRows<CommitmentRecord>(query,'commitments');
      const latest=new Map<string,CommitmentRecord>();
      for(const row of rows) if((latest.get(row.record.commitmentId)?.version??0)<row.record.version) latest.set(row.record.commitmentId,row.record);
      const items=[...latest.values()].filter(row=>intersects(row.participantIds,query.participantIds) && intersects([row.status],query.statuses) && (!query.dueAt || dateCommitmentDue(row,query.dueAt)))
        .sort((a,b)=>compareCoreIds(a.commitmentId,b.commitmentId));
      return paged(items,query,row=>row.commitmentId);
    },

    async queryJobs(input: JobQuery): Promise<Page<JobRecord>> {
      const query = ownQuery(input, ['statuses', 'kinds', 'jobIds', 'activeAttemptsOnly']);
      const rows = query.jobIds ? await transact(await database(), ['branches', 'jobs'], 'readonly', async tx => {
        const path = await branchPath(tx, query.scope, query.cutoffSeq), bound = path[0]!, records: StoredJob[] = [];
        for (const id of [...new Set(query.jobIds)]) {
          const row = await request<StoredJob | undefined>(tx.objectStore('jobs').get([...scopeKey(query.scope), id]));
          if (row && row.commitSeq <= bound.cutoffSeq) records.push(row);
        }
        return records;
      }) : await readRows<JobRecord>(query, 'jobs');
      const items = rows.map(row => {
        const publication = (row as StoredJob).publication;
        return publication ? { ...row.record, publicationReceipt: publication.receipt } : row.record;
      }).filter(row => (!query.activeAttemptsOnly || !row.retriedByJobId) && intersects([row.status], query.statuses) && intersects([row.kind], query.kinds)).sort((a, b) => compareCoreIds(a.jobId, b.jobId));
      return paged(items, query, job => job.jobId);
    },

    async enqueueJob(input: JobRecord): Promise<void> {
      const record = ownDto('job', input);
      if (record.publicationReceipt !== undefined || record.retriedByJobId !== undefined || record.status !== 'pending' || record.leaseId !== null || record.steps.length || record.version !== 1 || record.attempts !== 0) throw new Error('CORE2_INVALID_JOB_ENQUEUE');
      const db = await database();
      await transact(db, ['branches', 'jobs', 'sources', 'operations'], 'readwrite', async tx => {
        const current = await branch(tx, record.scope);
        if (current.head.sessionId !== record.sessionId) throw new Error('CORE2_SESSION_CHANGED');
        const store = tx.objectStore('jobs');
        const existing = await request<StoredJob | undefined>(store.get([...scopeKey(record.scope), record.jobId]));
        if (existing) {
          const immutable = (job: JobRecord) => ({ scope: job.scope, jobId: job.jobId, kind: job.kind, sourceRefs: job.sourceRefs,
            operationId: job.operationId, configFingerprint: job.configFingerprint, ...(job.retryOfJobId ? { retryOfJobId: job.retryOfJobId } : {}) });
          if (!sameData(immutable(existing.record), immutable(record))) throw new Error('CORE2_JOB_IDENTITY_EXISTS');
          return;
        }
        const operation = await operationForScope(tx, record.scope, record.operationId);
        if (operation?.status !== 'committed' || !await sourcesCommitted(tx, record.sourceRefs, current.head)) throw new Error('CORE2_JOB_SOURCE_NOT_COMMITTED');
        if (record.retryOfJobId) {
          const previous = await request<StoredJob | undefined>(store.get([...scopeKey(record.scope), record.retryOfJobId]));
          if (!previous || previous.record.jobId === record.jobId || previous.record.kind !== record.kind || previous.record.operationId !== record.operationId || !sameData(previous.record.sourceRefs, record.sourceRefs)) throw Error('CORE2_JOB_RETRY_IDENTITY');
          if (previous.record.retriedByJobId) throw Error('CORE2_JOB_REPLACEMENT_EXISTS');
          if (!['failed', 'cancelled'].includes(previous.record.status) || previous.publication) throw Error('CORE2_JOB_RETRY_NOT_TERMINAL');
          await request(store.put({ ...previous, record: { ...previous.record, retriedByJobId: record.jobId, version: previous.record.version + 1 } }));
        }
        await request(store.add({ scope: record.scope, commitSeq: current.head.coreSeq, record } satisfies StoredJob));
      });
    },

    async claimJob(input: JobClaim): Promise<JobRecord | null> {
      const claim = ownDto('jobClaim', input), db = await database();
      return transact(db, ['branches', 'jobs', 'sources'], 'readwrite', async tx => {
        const current = await branch(tx, claim.scope);
        const store = tx.objectStore('jobs'), key = [...scopeKey(claim.scope), claim.jobId];
        const job = await request<StoredJob | undefined>(store.get(key));
        if (!job || job.record.retriedByJobId || current.head.sessionId !== claim.sessionId || job.record.version !== claim.expectedVersion ||
          !sameData(job.record.sourceRefs, claim.sourceRefs) || !await sourcesCommitted(tx, claim.sourceRefs, current.head)) return null;
        if (job.record.status === 'running' && job.record.sessionId === claim.sessionId) return job.record.leaseId === claim.leaseId ? job.record : null;
        if (job.record.status === 'completed' || job.record.status === 'cancelled') return null;
        if (job.leaseIds?.includes(claim.leaseId)) return null;
        const active = await request<StoredJob[]>(store.index('by_scope').getAll(scopeKey(claim.scope)));
        for (const other of active) {
          if (other.record.jobId === claim.jobId && sameScope(other.record.scope, claim.scope)) continue;
          const maintenance = new Set(['turn_summary', 'compression', 'rebuild']);
          const overlap = maintenance.has(other.record.kind) && maintenance.has(job.record.kind) && other.record.sourceRefs.some(a => job.record.sourceRefs.some(b => sameData(a, b)));
          if (other.record.status === 'running' && (other.record.kind === job.record.kind || overlap) && current.head.sessionId === other.record.sessionId) return null;
        }
        const { failure: _previousFailure, ...previous } = job.record;
        const record: JobRecord = { ...previous, status: 'running', sessionId: claim.sessionId, leaseId: claim.leaseId,
          attempts: job.record.attempts + 1, version: job.record.version + 1 };
        await request(store.put({ ...job, record, leaseIds: [...(job.leaseIds ?? []), claim.leaseId] } satisfies StoredJob));
        return record;
      });
    },

    async cancelJob(input: CoreScope, jobId: string): Promise<void> {
      const scope = ownDto('scope', input); assertId(jobId);
      const db = await database();
      await transact(db, ['branches', 'jobs'], 'readwrite', async tx => {
        await branch(tx, scope);
        const store = tx.objectStore('jobs'), key = [...scopeKey(scope), jobId];
        const job = await request<StoredJob | undefined>(store.get(key));
        if (!job) throw new Error('CORE2_JOB_NOT_FOUND');
        if (job.record.status === 'completed' || job.record.status === 'cancelled') return;
        await request(store.put({ ...job, record: { ...job.record, status: 'cancelled', leaseId: null, version: job.record.version + 1 } }));
      });
    },

    async saveJobStep(input: JobStepResult): Promise<void> {
      const step = ownDto('jobStep', input), db = await database();
      await transact(db, ['branches', 'jobs', 'sources', 'memories', 'events'], 'readwrite', async tx => {
        const current = await branch(tx, step.scope);
        const store = tx.objectStore('jobs');
        const job = await request<StoredJob | undefined>(store.get([...scopeKey(step.scope), step.jobId]));
        if (!holderMatches(job, current.head, step) || !await sourcesCommitted(tx, step.sourceRefs, current.head)) throw new Error('CORE2_JOB_HOLDER_CHANGED');
        const existing = job.record.steps.find(item => item.stepId === step.stepId);
        if (existing) {
          if (sameData(existing, step)) return;
          if (existing.status === 'completed') throw new Error('CORE2_JOB_STEP_IMMUTABLE');
        }
        if (!await memoryProvenanceValid(tx, step.memories, step.sourceRefs, current.head, step.memories.flatMap(memory => memory.memoryRefs))) throw new Error('CORE2_INVALID_MEMORY_PROVENANCE');
        if (step.status === 'failed' && step.memories.length) throw new Error('CORE2_FAILED_STEP_HAS_RESULTS');
        await request(store.put({ ...job, record: { ...job.record, steps: [...job.record.steps.filter(item => item.stepId !== step.stepId), step], version: job.record.version + 1 } }));
      });
    },

    async finishJob(input: JobFinish): Promise<void> {
      const finish = ownDto('jobFinish', input), db = await database();
      await transact(db, ['branches', 'jobs'], 'readwrite', async tx => {
        const current = await branch(tx, finish.scope);
        const store = tx.objectStore('jobs');
        const job = await request<StoredJob | undefined>(store.get([...scopeKey(finish.scope), finish.jobId]));
        if (!holderMatches(job, current.head, finish) || job.record.version !== finish.expectedVersion) throw new Error('CORE2_JOB_HOLDER_CHANGED');
        const { failure: _previousFailure, ...previous } = job.record;
        const record: JobRecord = { ...previous, status: finish.status, leaseId: null, version: job.record.version + 1 };
        if (finish.failure) record.failure = finish.failure;
        await request(store.put({ ...job, record }));
      });
    },

    async publishDerived(input: DerivedPatch): Promise<DerivedReceipt> {
      const patch = ownDto('derived', input), db = await database();
      return transact(db, ['branches', 'jobs', 'sources', 'memories', 'events'], 'readwrite', async tx => {
        const current = await branch(tx, patch.scope);
        const rejected = (status: 'conflict' | 'cancelled', reason: string): DerivedReceipt => ({ status, reason, memoryRevision: current.head.memoryRevision, memoryIds: [] });
        const jobStore = tx.objectStore('jobs');
        const job = await request<StoredJob | undefined>(jobStore.get([...scopeKey(patch.scope), patch.jobId]));
        const fingerprint = checksumUtf8(stableJson(patch));
        const { additions, ...descriptor } = patch;
        // Exact replay only reads the durable receipt, even if the job has since
        // finished or stopped. It does not grant a former holder a new write.
        if (job?.publication?.leaseId === patch.leaseId && job.publication.fingerprint === fingerprint && sameData(job.publication.descriptor, descriptor) &&
          job.publication.receipt.memoryIds.length === additions.length) {
          let equal = true;
          for (const memory of additions) {
            const saved = await request<StoredMemory | undefined>(tx.objectStore('memories').get([...scopeKey(patch.scope), memory.memoryId, memory.version]));
            if (!saved || !sameData(saved.record, memory)) { equal = false; break; }
          }
          if (equal) return job.publication.receipt;
        }
        if (!holderMatches(job, current.head, patch)) return rejected('cancelled', 'job_holder_changed');
        if (job.publication) return rejected('conflict', 'job_already_published');
        if (patch.expectedMemoryRevision > current.head.memoryRevision || !unique(patch.readSet, ref => ref.memoryId) ||
          !unique(patch.additions, memory => memory.memoryId) || !unique(patch.supersededIds, id => id)) return rejected('conflict', 'invalid_memory_read_set');
        if (!patch.additions.length && !patch.supersededIds.length) return rejected('conflict', 'empty_memory_patch');
        if (!await sourcesCommitted(tx, patch.sourceRefs, current.head)) return rejected('conflict', 'source_not_committed');
        for (const read of patch.readSet) {
          const memory = await latestMemory(tx, patch.scope, read.memoryId);
          if (memory?.record.version !== read.version) return rejected('conflict', 'memory_read_version_changed');
        }
        for (const memory of patch.additions) {
          const latest = await latestMemory(tx, patch.scope, memory.memoryId);
          if (memory.version !== (latest?.record.version ?? 0) + 1 ||
            (latest && !patch.readSet.some(read => read.memoryId === memory.memoryId && read.version === latest.record.version)) ||
            patch.supersededIds.includes(memory.memoryId)) return rejected('conflict', 'memory_write_version_changed');
        }
        for (const id of patch.supersededIds) if (!patch.readSet.some(read => read.memoryId === id)) return rejected('conflict', 'replacement_not_in_read_set');
        if (!await memoryProvenanceValid(tx, patch.additions, patch.sourceRefs, current.head, patch.readSet)) return rejected('conflict', 'invalid_memory_provenance');
        const revision = current.head.memoryRevision + 1;
        const memoryStore = tx.objectStore('memories');
        for (const record of patch.additions) await request(memoryStore.add({ scope: patch.scope, commitSeq: current.head.coreSeq, publishedRevision: revision, record } satisfies StoredMemory));
        for (const id of patch.supersededIds) {
          const latest = (await latestMemory(tx, patch.scope, id))!;
          await request(memoryStore.add({ ...latest, scope: patch.scope, commitSeq: current.head.coreSeq, publishedRevision: revision,
            record: { ...latest.record, scope: patch.scope, version: latest.record.version + 1, status: 'superseded' } } satisfies StoredMemory));
        }
        fault('derived:memories');
        const receipt: DerivedReceipt = { status: 'published', memoryRevision: revision, memoryIds: patch.additions.map(memory => memory.memoryId) };
        await request(jobStore.put({ ...job, publication: { leaseId: patch.leaseId, fingerprint, descriptor, receipt } } satisfies StoredJob));
        await request(tx.objectStore('branches').put({ ...current, head: { ...current.head, memoryRevision: revision } } satisfies StoredBranch));
        fault('derived:receipt');
        return receipt;
      });
    },


    async publishSnapshot(input: SnapshotRecord, inputSlot: SaveSlot): Promise<void> {
      const snapshot = checkedSnapshot(input), slot = ownDto('saveSlot', inputSlot);
      if (slot.journeyId !== snapshot.scope.journeyId || slot.snapshotId !== snapshot.snapshotId) throw new Error('CORE2_SLOT_IDENTITY_MISMATCH');
      const db = await database();
      await transact(db, ['branches', 'states', 'snapshots', 'slots'], 'readwrite', async tx => {
        const snapshots = tx.objectStore('snapshots'), slots = tx.objectStore('slots');
        const existing = await request<SnapshotRecord | undefined>(snapshots.get(snapshot.snapshotId));
        if (existing && !sameData(existing, snapshot)) throw new Error('CORE2_SNAPSHOT_IMMUTABLE');
        const previousSlot = await request<SaveSlot | undefined>(slots.get(slot.slotId));
        if (previousSlot && (previousSlot.journeyId !== slot.journeyId || previousSlot.kind !== slot.kind)) throw new Error('CORE2_SLOT_IDENTITY_MISMATCH');
        // An exact acknowledged replay is read-only, even if the world advanced.
        if (existing && previousSlot && sameData(previousSlot, slot)) return;
        const current = await branch(tx, snapshot.scope);
        if (current.head.sessionId !== snapshot.state.head.sessionId) throw new Error('CORE2_SESSION_CHANGED');
        if (current.head.coreSeq !== snapshot.coreSeq || current.head.memoryRevision !== snapshot.memoryRevision) throw new Error('CORE2_SNAPSHOT_HEAD_CHANGED');
        const states = await request<StoredState[]>(tx.objectStore('states').index('by_scope').getAll(scopeKey(snapshot.scope)));
        if (!sameData(snapshot.state, snapshotState(current, states))) throw new Error('CORE2_SNAPSHOT_STATE_MISMATCH');
        if (!existing) await request(snapshots.add(snapshot));
        fault('snapshot:record');
        await request(slots.put(slot));
        await request(tx.objectStore('branches').put({ ...current,checkpointId:snapshot.snapshotId } satisfies StoredBranch));
        fault('snapshot:slot');
      });
    },

    async readSnapshot(snapshotId: string): Promise<SnapshotRecord | null> {
      assertId(snapshotId); const db = await database();
      return transact(db, ['snapshots'], 'readonly', async tx => {
        const snapshot = await request<SnapshotRecord | undefined>(tx.objectStore('snapshots').get(snapshotId));
        return snapshot ? checkedSnapshot(snapshot) : null;
      });
    },

    async listSaveSlots(journeyId: string): Promise<SaveSlot[]> {
      assertId(journeyId); const db = await database();
      return transact(db, ['slots'], 'readonly', async tx => {
        const slots = await request<SaveSlot[]>(tx.objectStore('slots').index('by_journey').getAll(journeyId));
        return slots.map(slot => ownDto('saveSlot', slot)).sort((a, b) => b.updatedAt - a.updatedAt || compareCoreIds(a.slotId, b.slotId));
      });
    },

    async readAsset(assetId: string): Promise<CoreAsset | null> {
      assertId(assetId); const db = await database();
      return transact(db, ['assets'], 'readonly', async tx => {
        const asset = await request<CoreAsset | undefined>(tx.objectStore('assets').get(assetId));
        return asset ? ownAsset(asset) : null;
      });
    },

    async publishAsset(input: AssetPublication): Promise<void> {
      const publication = ownAssetPublication(input), db = await database();
      await transact(db, ['branches', 'assets'], 'readwrite', async tx => {
        const current = await branch(tx, publication.scope);
        if (current.head.sessionId !== publication.sessionId) throw new Error('CORE2_SESSION_CHANGED');
        const store = tx.objectStore('assets');
        const previous = await request<CoreAsset | undefined>(store.get(publication.asset.assetId));
        if (previous) {
          if (!sameAsset(ownAsset(previous), publication.asset)) throw new Error('CORE2_ASSET_IMMUTABLE');
          return;
        }
        await request(store.add(publication.asset)); fault('asset:record');
      });
    },

    async fork(input: ForkRequest): Promise<BranchHead> {
      const fork = ownDto('fork', input);
      const scope = { journeyId: fork.parentScope.journeyId, branchId: fork.branchId };
      if (sameScope(scope, fork.parentScope)) throw new Error('CORE2_FORK_SAME_BRANCH');
      const db = await database();
      return transact(db, ['branches', 'states', 'snapshots'], 'readwrite', async tx => {
        const raw = await request<SnapshotRecord | undefined>(tx.objectStore('snapshots').get(fork.snapshotId));
        if (!raw) throw new Error('CORE2_SNAPSHOT_NOT_FOUND');
        const snapshot = checkedSnapshot(raw);
        if (!sameScope(snapshot.scope, fork.parentScope)) throw new Error('CORE2_FORK_PARENT_MISMATCH');
        const parent = await branch(tx, fork.parentScope);
        if (snapshot.coreSeq > parent.head.coreSeq || snapshot.memoryRevision > parent.head.memoryRevision) throw new Error('CORE2_FORK_FUTURE_SNAPSHOT');
        const existing = await request<StoredBranch | undefined>(tx.objectStore('branches').get(scopeKey(scope)));
        if (existing) {
          if (existing.originSnapshotId !== fork.snapshotId || !existing.head.parent || !sameScope(existing.head.parent, fork.parentScope)) throw new Error('CORE2_BRANCH_EXISTS');
          return existing.head;
        }
        const head: BranchHead = { scope, coreSeq: snapshot.coreSeq, memoryRevision: snapshot.memoryRevision, sessionId: fork.sessionId,
          parent: fork.parentScope, forkSeq: snapshot.coreSeq, forkMemoryRevision: snapshot.memoryRevision };
        await request(tx.objectStore('branches').add({ head, playerId: parent.playerId, contentRefs: snapshot.state.contentRefs,sourceCount:0, originSnapshotId: snapshot.snapshotId } satisfies StoredBranch));
        fault('fork:head');
        for (const record of snapshot.state.records) await request(tx.objectStore('states').add(storedState({ ...record, scope })));
        for (const ref of snapshot.state.tombstones ?? []) await request(tx.objectStore('states').add({ scope, domain: ref.domain, entityId: ref.entityId, version: ref.version, record: null } satisfies StoredState));
        fault('fork:states');
        const current = await branch(tx,scope);
        const states = await request<StoredState[]>(tx.objectStore('states').index('by_scope').getAll(scopeKey(scope)));
        const checkpoint = checkpointForState(snapshotState(current,states));
        await request(tx.objectStore('snapshots').add(checkpoint));
        await request(tx.objectStore('branches').put({ ...current,checkpointId:checkpoint.snapshotId } satisfies StoredBranch));
        return head;
      });
    },
  };
}
