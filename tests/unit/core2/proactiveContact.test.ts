import { expect, it } from 'vitest';
import { planCoreProactiveContact } from '@/core/settlement/proactiveContact';
import { makeSeed } from './fixtures';

it('uses only world main turns, existing contacts, affinity >=100 and a global fifteen-turn cooldown', () => {
  const seed = makeSeed(), snapshot = { head: seed.head, records: seed.records, contentRefs: [] };
  const world = snapshot.records.find(row => row.domain === 'world')!, npc = snapshot.records.find(row => row.domain === 'npc')!;
  if (world.domain !== 'world' || npc.domain !== 'npc') throw Error('fixture');
  npc.value.affinity = 100; world.value.completedMainTurns = 14;
  expect(planCoreProactiveContact(snapshot)).toBeNull();
  world.value.completedMainTurns = 15;
  const plan = planCoreProactiveContact(snapshot)!; expect(plan.npcId).toBe('npc-amber'); expect(plan.atTurn).toBe(15);
  expect(planCoreProactiveContact(snapshot)).toEqual(plan);
  world.value.proactiveLastTurn = 15; world.value.completedMainTurns = 29;
  expect(planCoreProactiveContact(snapshot)).toBeNull(); world.value.completedMainTurns = 30;
  expect(planCoreProactiveContact(snapshot)?.atTurn).toBe(30);
  npc.value.affinity = 99; expect(planCoreProactiveContact(snapshot)).toBeNull();
  npc.value.affinity = 200; snapshot.records = snapshot.records.filter(row => row.domain !== 'courier');
  expect(planCoreProactiveContact(snapshot)).toBeNull();
});
