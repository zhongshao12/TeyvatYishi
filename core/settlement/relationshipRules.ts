import type { FactCandidate, SourceRecord } from '../contracts/event';
import type { CoreSnapshot } from '../contracts/state';
import { mentionsIntimacyAct, scanNpcIntimacyEvents } from '@/utils/npcIntimacyEvidence';
import { resolveNpcAdultEligibility } from '@/utils/npcAdultEligibility';
import { getCanonicalArchiveBaselineAge } from '@/utils/npcArchiveBaseline';
import { 亲密事件好感规则 } from '@/utils/gameplayRules';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { stableJson } from '../persistence/repositoryValidation';
import { getNsfwArchiveBlockReason } from '@/utils/nsfwArchivePolicy';
import { matchCanonical } from '@/data/canonicalCharacters';

const fixedDelta = { sex: 亲密事件好感规则.性爱事件, kiss: 亲密事件好感规则.亲吻, flirt: 亲密事件好感规则.暧昧, touch: 亲密事件好感规则.肢体接触 };
function subjectsFor(state: CoreSnapshot) {
  return state.records.filter(r => r.domain === 'npc').map(npc => {
    const description = [npc.value.说明, npc.value.appearance, ...npc.value.notes].join(' '), baseline = getCanonicalArchiveBaselineAge(npc.value.姓名);
    return {
    id: npc.entityId, 姓名: npc.value.姓名, aliases: npc.value.aliases,
    eligible: resolveNpcAdultEligibility({ name: npc.value.姓名, aliases: npc.value.aliases,
      description, ageConfirmation: npc.value.matureArchive?.ageConfirmation,
      ageSource: npc.value.matureArchive?.ageConfirmationSource, canonicalBaselineAge: baseline }).confirmed,
    allowSex: getNsfwArchiveBlockReason(undefined, npc.value.姓名, `${[npc.value.姓名, ...npc.value.aliases].join(' ')} ${description}`,
      { canonicalAdultBaseline: baseline === 'adult' && Boolean(matchCanonical(npc.value.姓名)) }) === null,
  }; });
}

/** Resolve the participant against every known NPC, not an isolated target-name search. */
export function coreIntimacyMatch(candidate: Pick<FactCandidate, 'proposal' | 'evidenceRefs'>, state: CoreSnapshot, text = candidate.evidenceRefs.map(ref => ref.quote).join('\n')) {
  if (candidate.proposal.kind !== 'relationship') return undefined;
  const player = state.records.find(r => r.domain === 'traveler');
  const npcId = candidate.proposal.npcId;
  return scanNpcIntimacyEvents(text, subjectsFor(state),
    { playerName: player?.domain === 'traveler' ? player.value.姓名 : '', allowSex: true }).find(match => match.npcId === npcId && !match.ambiguous);
}

/** Reuses the existing evidence scanner and eligibility policy; this task does not rewrite B08/B09. */
export function fixedCoreAffinity(candidate: FactCandidate, state: CoreSnapshot): number | undefined {
  if (candidate.proposal.kind !== 'relationship') return undefined;
  const text = candidate.evidenceRefs.map(ref => ref.quote).join('\n');
  if (/每日同行|同行奖励|跨日奖励|斗地主.{0,12}(?:好感|奖励)/u.test(text)) return 0;
  const npcId = candidate.proposal.npcId;
  const npc = state.records.find(r => r.domain === 'npc' && r.entityId === npcId);
  if (!npc || npc.domain !== 'npc') return undefined;
  const subject = subjectsFor(state).find(row => row.id === npcId);
  if (!subject?.eligible) return mentionsIntimacyAct(text) ? 0 : undefined;
  const match = coreIntimacyMatch(candidate, state);
  // A protected or unassignable intimate claim must never fall back to the model's arbitrary delta.
  return match ? fixedDelta[match.tier] : mentionsIntimacyAct(text) ? 0 : undefined;
}

/** Host-owned proposals still pass ordinary source review, grouping and the atomic commit. */
export function deriveCoreRelationshipCandidates(sources: SourceRecord[], state: CoreSnapshot): FactCandidate[] {
  const player = state.records.find(r => r.domain === 'traveler');
  if (!player || player.domain !== 'traveler') return [];
  const subjects = subjectsFor(state), result: FactCandidate[] = [];
  for (const source of sources) if (source.kind === 'narrative') for (const block of source.blocks) if (block.kind === 'narration') {
    for (const match of scanNpcIntimacyEvents(block.text, subjects, { playerName: player.value.姓名, allowSex: true })) {
      if (match.ambiguous) continue;
      result.push({ candidateId: `fixed-relation-${checksumUtf8(stableJson([source.ref, block.blockId, match.npcId]))}`, scope: source.scope,
        operationId: source.operationId, kind: 'relationship', actors: [player.entityId], targets: [match.npcId], status: 'proposed',
        proposal: { kind: 'relationship', npcId: match.npcId, affinityDelta: fixedDelta[match.tier] },
        evidenceRefs: [{ ref: source.ref, blockId: block.blockId, start: 0, end: block.text.length, quote: block.text }] });
    }
  }
  return result;
}
