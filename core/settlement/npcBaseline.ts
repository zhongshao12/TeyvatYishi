import type { FactCandidate } from '../contracts/event';
import type { CoreSnapshot, NpcState } from '../contracts/state';
import { matchCanonical } from '@/data/canonicalCharacters';
import { isCanonicalIdentity } from '@/data/canonicalIdentity';
import { getDefaultBuiltinAvatar } from '@/data/builtinAvatars';

/** Only called for an already reviewed introduction. No borrowed contacts or private archive defaults. */
export function createCoreNpcBaseline(candidate: FactCandidate, snapshot: CoreSnapshot): NpcState | undefined {
  const p = candidate.proposal;
  if (p.kind !== 'npc' || p.action !== 'meet' || !p.npcId.startsWith('npc-')) return undefined;
  const traveler = snapshot.records.find(r => r.domain === 'traveler');
  const turn = snapshot.records.find(r => r.domain === 'world');
  return createCoreNpcProfile({ npcId: p.npcId, name: p.name, playerName: traveler?.domain === 'traveler' ? traveler.value.姓名 : '', turn: turn?.domain === 'world' ? turn.value.moment.turn : 0 });
}
/** Pure profile factory, also used for an explicitly selected opening companion. */
export function createCoreNpcProfile(input: { npcId: string; name: string; playerName: string; turn: number }): NpcState {
  const canon = matchCanonical(input.name), canonical = isCanonicalIdentity(input.name);
  return { id: input.npcId, 姓名: input.name, 地区: '', 身份: '', 天赋: [], 说明: '', aliases: canon?.aliases ?? [], roleTier: canonical ? 'companion' : 'extra', affinity: 0, relationship: '初见', intimate: false, travelingTogether: false, firstSeenTurn: input.turn, lastSeenTurn: input.turn, gender: canon?.gender ?? '其他', playerAddress: input.playerName, appearance: canon?.appearance ?? '', clothing: '', speechStyle: '', personality: canon?.personality ?? '', equipmentSummary: '', notes: [], playerCorrections: [], canonical, avatar: getDefaultBuiltinAvatar(input.name) ?? '', visualArchive: { slotImages: {} }, matureArchive: null };
}
