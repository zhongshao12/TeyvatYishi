import type { CoreSnapshot } from '../contracts/state';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { stableJson, compareCoreIds } from '../persistence/repositoryValidation';

export interface CoreProactivePlan { npcId: string; contactId: string; operationId: string; atTurn: number; previousTurn: number }
/** Pure eligibility only: no wall clock, model call, or speculative cooldown write. */
export function planCoreProactiveContact(snapshot: CoreSnapshot): CoreProactivePlan | null {
  const world = snapshot.records.find(row => row.domain === 'world');
  if (world?.domain !== 'world' || world.value.proactivePending || world.value.completedMainTurns - world.value.proactiveLastTurn < 15) return null;
  const candidates = snapshot.records.flatMap(contact => {
    if (contact.domain !== 'courier' || contact.value.kind !== 'contact' || !contact.value.available) return [];
    const npcId = contact.value.npcId;
    const npc = snapshot.records.find(row => row.domain === 'npc' && row.entityId === npcId);
    return npc?.domain === 'npc' && npc.value.affinity >= 100 && !npc.value.archived ? [{ npcId: npc.entityId, contactId: contact.entityId }] : [];
  }).sort((a, b) => compareCoreIds(a.npcId, b.npcId) || compareCoreIds(a.contactId, b.contactId));
  const unique = [...new Map(candidates.map(candidate => [candidate.npcId, candidate])).values()];
  if (!unique.length) return null;
  const selected = unique[(Math.floor(world.value.completedMainTurns / 15) - 1) % unique.length]!;
  const previousTurn = world.value.proactiveLastTurn, atTurn = world.value.completedMainTurns;
  return { ...selected, previousTurn, atTurn, operationId: `proactive-${checksumUtf8(stableJson([snapshot.head.scope, previousTurn, atTurn, selected.npcId]))}` };
}
