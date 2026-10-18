import type { WorldMoment, WorldMomentRange } from '@/models/teyvat/worldMoment';
import type { CoreScope, SourceRef } from './identity';
import type { FactProposal } from './state';
import type { StateChange } from './operation';

export type SourceKind = 'player_input' | 'narrative' | 'courier' | 'moment' | 'news' | 'image' | 'manual' | 'rule' | 'initialization' | 'content';
export interface SourceBlock { blockId: string; kind: 'narration' | 'dialogue' | 'message' | 'configuration' | 'rule' | 'content'; text: string; speakerId?: string }
export interface PromptDeliveryAudit { version: 1; bundles: { bundleId: string; target: 'main' | 'private' | 'group' | 'moment' | 'news' | 'image'; npcIds: string[]; selectedLeafIds: string[] }[]; worldbookEntryIds: string[] }
export interface SourceRecord { ref: SourceRef; scope: CoreScope; operationId: string; kind: SourceKind; blocks: SourceBlock[]; moment: WorldMoment; createdAt: number; delivery?: PromptDeliveryAudit; publicCitations?: { blockId: string; eventIds: string[] }[]; assetRefs?: string[] }
export interface EvidenceRef { ref: SourceRef; blockId: string; start: number; end: number; quote: string }
export type FactStatus = 'proposed' | 'verified' | 'pending' | 'disputed' | 'rejected';
export interface FactCandidate { candidateId: string; scope: CoreScope; operationId: string; kind: FactProposal['kind']; actors: string[]; targets: string[]; proposal: FactProposal; evidenceRefs: EvidenceRef[]; status: FactStatus; reason?: string }
export interface EventVisibility { kind: 'public' | 'participants' | 'private'; npcIds: string[] }
export interface GameEvent {
  eventId: string; journeyId: string; branchId: string; operationId: string; commitSeq: number;
  turn: number; type: string; actorIds: string[]; targetIds: string[]; evidenceRefs: EvidenceRef[];
  occurredMoment: WorldMoment; momentRange?: WorldMomentRange; ruleVersion: string;
  committedChanges: StateChange[]; visibility: EventVisibility; recordedAt: number;
  correctionOf?: string;
  /** Stable delivery channel, never a character's mutable display name. */
  channelId?: string;
  sourceOrder?: number;
  replyToEventId?: string;
  /** Confirmed typed proposal, retained for deterministic knowledge/commitment projection and audit. */
  fact?: FactProposal;
}
export type EventDraft = Omit<GameEvent, 'commitSeq'>;
