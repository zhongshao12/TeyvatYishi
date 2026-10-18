import type { TravelerProfile, TeyvatNpcRecord, TeyvatNpcMatureArchive, TeyvatNpcVisualArchive } from '@/models/teyvat/character';
import type { ElementId } from '@/models/teyvat/elements';
import type { RegionId } from '@/models/teyvat/world';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import type { DoudizhuGame } from '@/models/teyvat/doudizhu';
import type { QuestEntry, QuestObjective } from '@/models/teyvat/runtimeSlices';
import type { BranchHead, ContentRef, CoreScope, RecordRef, SourceRef } from './identity';
import type { CommitmentTrigger } from './knowledge';

export type CoreVisualLinks = Pick<TeyvatNpcVisualArchive, 'englishFacts' | 'characterAnchor' | 'profileImage' | 'fullPortrait' | 'slotImages' | 'status' | 'source'>;
export type TravelerState = Omit<TravelerProfile, 'visualArchive'> & {
  visualArchive: CoreVisualLinks;
  level: number;
  health: number;
  experience: number;
};
export type NpcPrivateState = Omit<TeyvatNpcMatureArchive, 'experiences' | 'longTermFacts' | 'notes'>;
export type NpcState = Omit<TeyvatNpcRecord, 'sharedMemories' | 'relationshipLedger' | 'visualArchive' | 'matureArchive'> & {
  canonicalId?: string;
  visualArchive: CoreVisualLinks;
  matureArchive: NpcPrivateState | null;
};
export interface WorldState {
  moment: WorldMoment;
  region: RegionId | '';
  visitedRegions: RegionId[];
  atmosphere: string;
  completedMainTurns: number;
  proactiveLastTurn: number;
  worldbookTriggers?: Record<string, number>;
  opening?: { presetId: string; storyMode: 'normal' | 'harem' | 'romance_alt' | 'deep_single'; travelerPreset: 'custom' | '空' | '荧'; canonicalCompanion: '' | '空' | '荧' };
  proactivePending?: { originBranchId: string; npcId: string; contactId: string; operationId: string; atTurn: number; previousTurn: number; jobId: string; channelId: string; moment: WorldMoment };
}
export type InventoryState =
  | { kind: 'item'; name: string; category: 'weapon' | 'artifact' | 'food' | 'material' | 'gadget' | 'quest' | 'furnishing'; quantity: number; rarity: 1 | 2 | 3 | 4 | 5; description: string; status: 'owned' | 'depleted' | 'discarded' }
  | { kind: 'wallet'; mora: number };
export type QuestState = QuestEntry;
export interface CoreQuestDefinition { title: string; objectives: Pick<QuestObjective, 'description' | 'type' | 'targetCount'>[] }
export type StoryContentField = 'seriesTitle' | 'chapterTitle' | 'title' | 'location' | 'goal' | 'completionEvidence' | 'referenceText';
export interface StoryContentEdit { seriesId: string; nodeId: string; field: StoryContentField; baseFingerprint: string; value: string | string[] }
export interface StoryState { seriesId: string | null; chapterId: string | null; nodeId: string | null; status: 'not_started' | 'progressing' | 'completed' | 'diverged' | 'paused'; completedNodeIds: string[]; resourceEdits?: StoryContentEdit[] }
export type CourierState =
  | { kind: 'contact'; npcId: string; name: string; remark: string; avatarAssetId?: string; available: boolean }
  | { kind: 'conversation'; name: string; memberIds: string[]; conversationType: 'private' | 'group'; unreadCount: number; lastReadSeq: number; dissolved: boolean }
  | { kind: 'moment'; authorId: string; sourceRef: SourceRef; imageAssetIds: string[]; mentionedNpcIds: string[]; visibilityNpcIds: string[]; commentNpcIds?: string[]; randomCommentNpcIds?: string[]; commentPlanSeq?: number; commentReplies?: { npcId: string; jobId: string; operationId: string }[] };
export interface NewsState { issueId: string; sourceRef: SourceRef; eventIds: string[]; moment: WorldMoment }
export interface AlbumState { entryId: string; title: string; kind: 'scene' | 'character' | 'snapshot'; assetId: string; sourceRefs: SourceRef[]; npcIds: string[]; moment: WorldMoment; phoneOrigin?: { conversationId: string; playerEventId: string; npcId: string } }
export interface MapState { locationId: string; name: string; region: RegionId; visited: boolean; parentId?: string }
export interface DoudizhuState { currentGame: Omit<DoudizhuGame, 'publicLog'> | null; lastError?: string }
export interface CoreDomainValues {
  traveler: TravelerState; world: WorldState; npc: NpcState; inventory: InventoryState;
  quest: QuestState; story: StoryState; courier: CourierState; news: NewsState;
  album: AlbumState; map: MapState; doudizhu: DoudizhuState;
}
export type CoreDomain = keyof CoreDomainValues;
export type StateRecord<D extends CoreDomain = CoreDomain> = {
  [K in D]: { scope: CoreScope; domain: K; entityId: string; version: number; value: CoreDomainValues[K] }
}[D];
export interface CoreSnapshot { head: BranchHead; records: StateRecord[]; contentRefs: ContentRef[]; tombstones?: RecordRef[] }
export type ProfileField = 'appearance' | 'clothing' | 'personality' | 'speechStyle' | 'playerAddress';
export type FactProposal =
  | { kind: 'inventory'; action: 'gain' | 'consume' | 'give' | 'transfer'; itemId: string; quantity: number; recipientId?: string; itemName?: string }
  | { kind: 'currency'; delta: number }
  | { kind: 'traveler'; field: 'health' | 'experience' | 'level'; value: number }
  | { kind: 'time'; elapsedMinutes: number; date?: string; clock?: string }
  | { kind: 'location'; location: string; region?: RegionId }
  | { kind: 'weather'; weather: string }
  | { kind: 'npc'; npcId: string; name: string; action: 'meet' | 'join' | 'leave' }
  | { kind: 'quest'; questId: string; action: 'start' | 'progress' | 'complete' | 'fail'; objectiveId?: string; amount?: number; definition?: CoreQuestDefinition }
  | { kind: 'relationship'; npcId: string; affinityDelta: number; relationship?: string }
  | { kind: 'commitment'; action: 'create' | 'fulfill' | 'cancel'; commitmentId: string; text: string; participantIds: string[]; trigger?: CommitmentTrigger }
  | { kind: 'experience'; participantIds: string[]; description: string }
  | { kind: 'profile'; npcId: string; field: ProfileField; value: string }
  | { kind: 'element'; element: ElementId; unlocked: boolean }
  | { kind: 'talent'; talentId: string; element: ElementId | ''; level: number }
  | { kind: 'story'; action?: 'enter' | 'complete'; seriesId: string; chapterId: string; nodeId: string };
