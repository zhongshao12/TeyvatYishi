import type { FactCandidate } from '../contracts/event';
import type { CoreSnapshot, StateRecord } from '../contracts/state';
import { coreEntityNamePattern } from './entityResolution';

/** A small, evidenced leaf, not permission to expose the containing narrative. */
export function sharedExperienceProblem(candidate: FactCandidate, state: CoreSnapshot): string | undefined {
  const proposal = candidate.proposal;
  if (proposal.kind !== 'experience') return '不是共同经历候选。';
  const ids = proposal.participantIds, ref = candidate.evidenceRefs[0];
  if (!ref || candidate.evidenceRefs.length !== 1 || proposal.description !== ref.quote) return '共同经历必须逐字引用一个完整片段。';
  if (ids.length < 2 || ids.length > 8 || new Set(ids).size !== ids.length || candidate.actors.length !== ids.length || !ids.every(id => candidate.actors.includes(id))) return '共同经历参与者必须唯一且与行动主体一致。';
  const participants = ids.map(id => state.records.find((row): row is StateRecord<'traveler' | 'npc'> => (row.domain === 'traveler' || row.domain === 'npc') && row.entityId === id));
  if (participants.some(row => !row)) return '共同经历参与者尚未可靠建档。';
  const text = ref.quote.trim().replace(/[。.!！?？]$/u, '');
  if (/[，,；;。.!！?？\n“”「」"：:]/u.test(text) || /准备|打算|计划|明天|将会|没有|并未|未曾|可能|或许|假如|听说|听闻|据说|声称|告诉|告知|说|回忆|曾经|希望|邀请|约定|承诺|答应/u.test(text)) return '计划、转述、对话或混合片段不能成为共同经历。';
  const joint = text.match(/^(.+?)(?:一起|一同|共同)(.+)$/u);
  if (!joint || !/(?:散步|旅行|探索|游览|用餐|调查|看花|赏花|露营|赶路|采集|野餐|钓鱼|打牌|品茶|休息)/u.test(joint[2]!)) return '尚未发现已经发生的共同活动。';
  const patterns = participants.map(row => `(?:${coreEntityNamePattern(row!, state)}${row!.domain === 'traveler' ? '|玩家|你' : ''})`);
  const subject = joint[1]!;
  // Names belong in the joint subject, not in an unrelated clause or cast list.
  if (!new RegExp(`^(?:${patterns.join('|')})(?:(?:和|与|、|及)(?:${patterns.join('|')})){1,7}(?:在[^，,；;。]+)?$`, 'u').test(subject)
    || !patterns.every(pattern => new RegExp(pattern, 'iu').test(subject))) return '原文没有明确这些人物共同参与。';
  return undefined;
}
