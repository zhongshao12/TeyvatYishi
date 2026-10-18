import type { FactCandidate, SourceRecord } from '../contracts/event';
import type { CoreSnapshot, FactProposal, ProfileField } from '../contracts/state';
import type { FactReviewResult } from './evidenceReview';
import type { DoudizhuMove } from '@/models/teyvat/doudizhu';
import { validateCoreDto } from '../contracts/validation';
import { stableJson } from '../persistence/repositoryValidation';
import { groupCoreActions, type ActionGroup } from './dependencyGroups';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import type { CoreScope } from '../contracts/identity';

export type BasicPlayerCommand =
  | { type: 'edit_npc'; npcId: string; field: ProfileField | '姓名' | 'affinity' | 'archived'; value: string | number | boolean }
  | { type: 'edit_traveler'; field: '姓名' | '别名' | '性别' | '年龄' | '生日' | '身高' | '身份' | '外貌' | '性格' | '背景'; value: string | number }
  | { type: 'contact_remark'; contactId: string; remark: string }
  | { type: 'contact'; npcId: string; action: 'add' | 'remove' }
  | { type: 'conversation_create'; conversationId: string; name: string; conversationType: 'private' | 'group'; memberIds: string[] }
  | { type: 'conversation_read'; conversationId: string; expectedVersion: number; throughSeq: number }
  | { type: 'inventory'; itemId: string; action: 'consume' | 'discard'; quantity: number }
  | { type: 'group'; conversationId: string; action: 'rename' | 'add' | 'remove' | 'dissolve'; name?: string; npcId?: string }
  | { type: 'message'; conversationId: string; text: string }
  | { type: 'moment'; momentId: string; action: 'publish' | 'edit' | 'delete'; text?: string; mentionedNpcIds?: string[]; imageAssetIds?: string[]; visibilityNpcIds?: string[] }
  | { type: 'image'; entryId: string; assetId: string }
  | { type: 'image_bind'; entryId: string; target: 'npc' | 'traveler'; targetId: string; slot: 'profile' | 'courier' | 'narrative'; expectedVersion: number }
  | { type: 'image_delete'; entryId: string; expectedVersion: number }
  | { type: 'image_profile_cache'; npcId: string; expectedVersion: number; cache: import('@/models/imageCharacterEnglish').ImageCharacterEnglishCache }
  | { type: 'map'; locationId: string }
  | { type: 'element'; element: import('@/models/teyvat/elements').ElementId }
  | { type: 'talent'; talentId: string; element: import('@/models/teyvat/elements').ElementId | ''; level: number }
  | { type: 'doudizhu_start'; npcIds: [string, string]; seed: number; gameId: string }
  | { type: 'doudizhu_move'; move: DoudizhuMove }
  | { type: 'doudizhu_turn'; gameId: string; expectedVersion: number; move?: DoudizhuMove }
  | { type: 'doudizhu_abandon'; gameId: string; expectedVersion: number }
  | { type: 'story_edit'; seriesId: string; chapterId: string; nodeId: string }
  | { type: 'story_content'; action: 'set' | 'reset'; seriesId: string; nodeId: string; field: import('../contracts/state').StoryContentField; expectedVersion: number; baseFingerprint: string; value?: string | string[] }
  | { type: 'memory_edit'; memoryId: string; expectedVersion: number; text: string; pinned?: boolean; importance?: number };
export type PlayerCommand = BasicPlayerCommand
  | { type: 'review_fact'; candidate: FactCandidate; groupCandidates?: FactCandidate[]; decision: 'accept' | 'reject'; originOperationId: string }
  | { type: 'correct_event'; originalEventId: string; reason: string; command: BasicPlayerCommand };
interface ActionIdentity { actionId: string; dependsOn?: string[]; blockedReason?: string; sourceOrder?: number }
export type NarrativeAction = ActionIdentity & { kind: 'narrative'; candidate: FactCandidate };
export type CoreAction = NarrativeAction | ActionIdentity & { kind: 'player'; source: SourceRecord; command: PlayerCommand };
export interface ActionBuildResult { groups: ActionGroup[]; pending: FactCandidate[]; rejected: FactCandidate[] }
export const coreCandidateReviewId = (scope: CoreScope, originOperationId: string, candidateId: string) => `review-${checksumUtf8(JSON.stringify([scope, originOperationId, candidateId]))}`;

function proposalTarget(proposal: FactProposal): string {
  if ('npcId' in proposal) return proposal.npcId;
  if ('itemId' in proposal) return proposal.itemId;
  if ('questId' in proposal) return proposal.questId;
  if ('commitmentId' in proposal) return proposal.commitmentId;
  if ('talentId' in proposal) return proposal.talentId;
  if ('nodeId' in proposal) return proposal.nodeId;
  if ('element' in proposal) return proposal.element;
  return proposal.kind;
}
/** Compact storage identity only. Full candidate/evidence is retained and compared; the checksum grants no authority. */
function identity(candidate: FactCandidate): string {
  const p = candidate.proposal;
  const anchors = candidate.evidenceRefs.map(r => [r.ref.sourceId, r.ref.sourceVersion, r.blockId, r.start, r.end]);
  return `action-${checksumUtf8(stableJson([candidate.scope, candidate.operationId, anchors, p.kind, proposalTarget(p), 'action' in p ? p.action : 'field' in p ? p.field : p.kind]))}`;
}
export function buildCoreActions(review: FactReviewResult, state: CoreSnapshot): ActionBuildResult {
  const actions = new Map<string, NarrativeAction>();
  const rejected = [...structuredClone(review.rejected)];
  const pending = structuredClone([...review.pending, ...review.disputed]);
  for (const candidate of [...review.verified, ...review.pending, ...review.disputed]) {
    if (!validateCoreDto('candidate', candidate).ok || !['verified', 'pending', 'disputed'].includes(candidate.status) || candidate.scope.journeyId !== state.head.scope.journeyId || candidate.scope.branchId !== state.head.scope.branchId) {
      rejected.push({ ...structuredClone(candidate), status: 'rejected', reason: '候选尚未审核或不属于当前存档。' }); continue;
    }
    const actionId = identity(candidate);
    const previous = actions.get(actionId);
    if (previous) {
      if (candidate.status !== 'verified') previous.blockedReason = candidate.reason ?? '同组证据尚待核对。';
      if (stableJson([previous.candidate.scope, previous.candidate.operationId, previous.candidate.evidenceRefs, previous.candidate.proposal, previous.candidate.actors, previous.candidate.targets]) !== stableJson([candidate.scope, candidate.operationId, candidate.evidenceRefs, candidate.proposal, candidate.actors, candidate.targets])) previous.blockedReason = '同一证据动作出现互相冲突的提议或身份冲突。';
    } else {
      const ref = candidate.evidenceRefs[0]!;
      const sourceOrder = review.sourceOrder?.indexOf(JSON.stringify([ref.ref.sourceId, ref.ref.sourceVersion, ref.blockId]));
      actions.set(actionId, { kind: 'narrative', actionId, candidate: structuredClone(candidate), ...(candidate.status === 'verified' ? {} : { blockedReason: candidate.reason ?? '同组证据尚待核对。' }), ...(sourceOrder === undefined ? {} : { sourceOrder }) });
    }
  }
  return { groups: groupCoreActions([...actions.values()]), pending, rejected };
}
