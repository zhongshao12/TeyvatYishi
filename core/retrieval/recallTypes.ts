import type { WorldMoment } from '@/models/teyvat/worldMoment';
import type { BranchHead, CoreScope, SourceRef } from '../contracts/identity';
import type { Audience } from '../contracts/knowledge';
import type { CoreRepository, IndexStatus } from '../contracts/storage';

export interface CoreRecallRequest {
  scope: CoreScope; head: BranchHead; audience: Audience; entityIds: string[]; locations: string[];
  query: string; moment: WorldMoment; k?: number; optionalTokenBudget?: number; signal?: AbortSignal;
}
export interface RecallDependencies { repo: CoreRepository }
export interface RecallItem {
  eventId: string; leafIds: string[]; sourceRefs: SourceRef[]; text: string; memoryId?: string; commitmentId?: string;
  kind: 'event' | 'utterance' | 'narration' | 'summary' | 'commitment'; speakerId?: string; meaning?: string; reason: string; protected: boolean;
  rank: { entities: number; locations: number; terms: number; importance: number; recent: number; unfinished: number };
}
export interface CoreRecallResult {
  bundleId: string; scope: CoreScope; coreSeq: number; memoryRevision: number; audience: Audience;
  mandatory: RecallItem[]; optional: RecallItem[]; selectedLeafIds: string[];
  indexPosition: IndexStatus; completeness: 'complete'; rankingVersion: string;
  diagnostics: { id: string; reason: string }[];
}
export interface MemoryContextBundle {
  bundleId: string; mandatoryText: string; optionalText: string; selectedLeafIds: string[];
  estimatedTokens: number; budgetOverflow: boolean; diagnostics: CoreRecallResult['diagnostics'];
}
