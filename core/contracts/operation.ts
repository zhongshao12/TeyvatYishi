import type { CoreScope, RecordRef, SourceRef } from './identity';
import type { EventDraft, FactCandidate, SourceRecord } from './event';
import type { StateRecord } from './state';
import type { KnowledgeRecord, CommitmentRecord } from './knowledge';
import type { JobRecord } from './memory';

export type OperationKind = 'main' | 'courier' | 'moment' | 'manual' | 'system' | 'initialization';
export type OperationStatus = 'draft' | 'prepared' | 'committed' | 'failed' | 'cancelled';
export interface OperationRecord { scope: CoreScope; operationId: string; kind: OperationKind; status: OperationStatus; sourceRefs: SourceRef[]; readSet: RecordRef[]; candidateRefs: string[]; effects: string[]; attempts: number; receipt?: CommitReceipt; stage?: OperationStage; failure?: { code: string; detail: string } }
export interface OperationStage { scope: CoreScope; sessionId: string; operationId: string; sourceRefs: SourceRef[]; candidates: FactCandidate[]; review: { candidateId: string; status: FactCandidate['status']; reason: string }[]; stageVersion: number }
export interface StateChange { ref: RecordRef; before: StateRecord | null; after: StateRecord | null; effectKey: string }
export interface PreparedCommit { scope: CoreScope; sessionId: string; operationId: string; readSet: RecordRef[]; sourceRefs: SourceRef[]; changes: StateChange[]; events: EventDraft[]; knowledge: KnowledgeRecord[]; commitments: CommitmentRecord[]; jobs: JobRecord[]; jobGuard?: { jobId: string; leaseId: string; expectedVersion: number; sourceRefs: SourceRef[] } }
export type CommitReceipt =
  | { status: 'committed' | 'already_committed'; scope: CoreScope; operationId: string; coreSeq: number; eventIds: string[]; jobIds: string[] }
  | { status: 'conflict' | 'cancelled'; scope: CoreScope; operationId: string; coreSeq: number; eventIds: string[]; jobIds: string[]; reason: string };
export interface CoreCommitFailure { status: 'failed'; scope: CoreScope; operationId: string; code: string; detail: string }
export interface JourneySeed { head: import('./identity').BranchHead; playerId: string; records: StateRecord[]; contentRefs: import('./identity').ContentRef[]; sources: SourceRecord[] }
