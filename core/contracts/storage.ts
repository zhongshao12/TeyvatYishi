import type { WorldMoment } from '@/models/teyvat/worldMoment';
import type { BranchHead, CoreScope, SourceRef, MemoryReadRef } from './identity';
import type { GameEvent, SourceKind, SourceRecord } from './event';
import type { CoreSnapshot } from './state';
import type { CommitReceipt, JourneySeed, OperationRecord, OperationStage, PreparedCommit, OperationKind, OperationStatus } from './operation';
import type { CommitmentRecord, KnowledgeRecord } from './knowledge';
import type { DerivedPatch, DerivedReceipt, JobClaim, JobFinish, JobRecord, JobStepResult, MemoryLayer, MemoryRecord } from './memory';
export { validateCoreDto } from './validation';

export interface Page<T> { items: T[]; nextCursor?: string }
export interface JourneyQuery { cursor?: string; limit?: number }
export interface JourneyEntry { scope: CoreScope; name: string; turn: number; coreSeq: number; parentBranchId?: string }
export interface CoreQuery { scope: CoreScope; cutoffSeq: number; cursor?: string; limit?: number }
export interface CommittedOperationQuery extends CoreQuery { afterSeq: number; kinds?: OperationKind[]; direction?: 'asc' | 'desc' }
export interface OperationQuery extends CoreQuery { statuses: OperationStatus[]; kinds?: OperationKind[] }
export interface EventQuery extends CoreQuery { afterSeq?:number; eventIds?: string[]; npcIds?: string[]; types?: string[]; turns?: number[]; locations?: string[]; channelIds?: string[]; direction?: 'asc' | 'desc' }
export interface MemoryQuery extends CoreQuery { memoryRevision: number; afterRevision?:number; memoryIds?: string[]; npcIds?: string[]; layers?: MemoryLayer[]; statuses?: MemoryRecord['status'][]; turns?: number[]; keywords?: string[]; locations?: string[] }
export interface MemoryVersionQuery { scope: CoreScope; cutoffSeq: number; memoryRevision: number; refs: MemoryReadRef[] }
export interface SourceQuery extends CoreQuery { refs?: SourceRef[]; kinds?: SourceKind[]; operationId?: string }
export interface KnowledgeQuery extends CoreQuery { npcIds?: string[]; eventIds?: string[] }
export interface CommitmentQuery extends CoreQuery { participantIds?: string[]; statuses?: CommitmentRecord['status'][]; dueAt?: WorldMoment }
export interface JobQuery extends CoreQuery { statuses?: JobRecord['status'][]; kinds?: JobRecord['kind'][]; jobIds?: string[]; activeAttemptsOnly?: boolean }
export interface SnapshotRecord { snapshotId: string; scope: CoreScope; coreSeq: number; memoryRevision: number; state: CoreSnapshot; createdAt: number; checksum: string }
export interface SaveSlot { slotId: string; journeyId: string; kind: 'manual' | 'auto'; snapshotId: string; turn: number; name: string; updatedAt: number }
export interface SaveSlotRequest { scope: CoreScope; kind: 'manual' | 'auto'; currentSlotId?: string; asNew: boolean; turn: number; name: string }
export interface ForkRequest { snapshotId: string; parentScope: CoreScope; branchId: string; sessionId: string }
export interface CoreAsset { assetId: string; scope: CoreScope; mimeType: string; bytes: Uint8Array; checksum: string }
export interface AssetPublication { scope: CoreScope; sessionId: string; asset: CoreAsset }
export interface CorePackageManifest { kind: 'teyvat-core2-package'; formatVersion: 1; scope: CoreScope; snapshotId: string; files: { path: string; checksum: string; size: number }[]; containsPrivateData: boolean }
export interface ImportedBranch { playerId: string; state: CoreSnapshot; originSnapshotId?: string }
/** A consistent, read-only export boundary. Positions are actual persisted metadata. */
export interface ExportBranch { playerId: string; head: BranchHead; originSnapshotId?: string }
export interface ExportRecords extends Omit<PreparedImport, 'manifest' | 'branches'> { scope: CoreScope; branches: ExportBranch[] }
export interface PositionedRecord<T> { record: T; commitSeq: number }
export interface ImportedSource { record: SourceRecord; commitSeq: number | null }
export interface SourcePosition {ref:SourceRef;scope:CoreScope;operationId:string;kind:SourceKind;commitSeq:number|null}
export interface OperationSourceAppend { scope: CoreScope; sessionId: string; operationId: string; source: SourceRecord }
export interface ImportedMemory extends PositionedRecord<MemoryRecord> { publishedRevision: number }
export interface DerivedPublication { leaseId: string; fingerprint: string; descriptor: Omit<DerivedPatch, 'additions'>; receipt: DerivedReceipt }
export interface ImportedJob extends PositionedRecord<JobRecord> { leaseIds: string[]; publication?: DerivedPublication }
/** Already decoded, ID-remapped data. Positions are explicit; importing never guesses them. */
export interface PreparedImport { manifest: CorePackageManifest; branches: ImportedBranch[]; sources: ImportedSource[]; events: GameEvent[]; operations: OperationRecord[]; memories: ImportedMemory[]; knowledge: PositionedRecord<KnowledgeRecord>[]; commitments: PositionedRecord<CommitmentRecord>[]; jobs: ImportedJob[]; snapshots: SnapshotRecord[]; slots: SaveSlot[]; assets: CoreAsset[] }
export interface IntegrityReport { ok: boolean; errors: string[]; checkedRecords: number }
export interface IndexStatus { scope: CoreScope; coreSeq: number; memoryRevision: number; indexVersion: number; status: 'ready' | 'lagging' | 'missing'; contentVersion?: 'recall-v2' }
export interface IndexPosting { scope: CoreScope; kind: 'npc' | 'location' | 'keyword' | 'type'; key: string; target: 'event' | 'memory'; targetId: string; commitSeq: number; memoryRevision: number }
export interface IndexTarget {target:'event'|'memory';targetId:string}
export interface IndexPatch { scope: CoreScope; sessionId: string; cutoffSeq: number; memoryRevision: number; expectedIndexVersion: number; postings: IndexPosting[]; mode?:'replace'|'merge'; replacedTargets?:IndexTarget[]; contentVersion?: 'recall-v2' }
export interface PostingQuery extends CoreQuery {memoryRevision:number;kind?:IndexPosting['kind'];keys?:string[];target?:IndexPosting['target']}
export interface IndexReceipt { status: 'published' | 'conflict' | 'cancelled'; indexVersion: number; reason?: string }
export interface CoreRepository {
  queryJourneys(query: JourneyQuery): Promise<Page<JourneyEntry>>;
  initialize(input: JourneySeed): Promise<BranchHead>;
  readHead(scope: CoreScope): Promise<BranchHead>;
  activateSession(scope: CoreScope, sessionId: string): Promise<BranchHead>;
  readState(scope: CoreScope): Promise<CoreSnapshot>;
  readRecoveryCheckpoint(scope: CoreScope): Promise<SnapshotRecord>;
  readExportRecords(scope: CoreScope): Promise<ExportRecords>;
  putSource(input: SourceRecord): Promise<SourceRef>;
  appendOperationSource(input: OperationSourceAppend): Promise<OperationRecord>;
  readSource(ref: SourceRef): Promise<SourceRecord | null>;
  prepareOperation(input: OperationRecord): Promise<void>;
  stageOperation(input: OperationStage): Promise<void>;
  cancelOperation(scope: CoreScope, operationId: string): Promise<void>;
  readOperation(scope: CoreScope, operationId: string): Promise<OperationRecord | null>;
  commit(input: PreparedCommit): Promise<CommitReceipt>;
  publishDerived(input: DerivedPatch): Promise<DerivedReceipt>;
  queryEvents(query: EventQuery): Promise<Page<GameEvent>>;
  queryCommittedOperations(query: CommittedOperationQuery): Promise<Page<OperationRecord>>;
  queryOperations(query: OperationQuery): Promise<Page<OperationRecord>>;
  queryMemories(query: MemoryQuery): Promise<Page<MemoryRecord>>;
  queryMemoryRows(query:MemoryQuery):Promise<Page<ImportedMemory>>;
  readMemoryVersions(query: MemoryVersionQuery): Promise<MemoryRecord[]>;
  querySources(query: SourceQuery): Promise<Page<SourceRecord>>;
  queryKnowledge(query: KnowledgeQuery): Promise<Page<KnowledgeRecord>>;
  queryCommitments(query: CommitmentQuery): Promise<Page<CommitmentRecord>>;
  queryJobs(query: JobQuery): Promise<Page<JobRecord>>;
  enqueueJob(input: JobRecord): Promise<void>;
  cancelJob(scope: CoreScope, jobId: string): Promise<void>;
  saveJobStep(step: JobStepResult): Promise<void>;
  claimJob(input: JobClaim): Promise<JobRecord | null>;
  finishJob(input: JobFinish): Promise<void>;
  publishSnapshot(input: SnapshotRecord, slot: SaveSlot): Promise<void>;
  readSnapshot(snapshotId: string): Promise<SnapshotRecord | null>;
  listSaveSlots(journeyId: string): Promise<SaveSlot[]>;
  fork(input: ForkRequest): Promise<BranchHead>;
  readAsset(assetId: string): Promise<CoreAsset | null>;
  publishAsset(input: AssetPublication): Promise<void>;
  importPrepared(input: PreparedImport): Promise<BranchHead>;
  readIndexStatus(scope: CoreScope): Promise<IndexStatus>;
  queryPostings(query:PostingQuery):Promise<Page<IndexPosting>>;
  publishIndex(input: IndexPatch): Promise<IndexReceipt>;
}
