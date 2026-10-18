import { expect, it } from 'vitest';
import { selectCoreMomentResponders } from '@/core/retrieval/momentContext';
import { NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD } from '@/models/npc';
import { makeSeed } from './fixtures';

it('always includes visible @mentions regardless of affinity, then at most three eligible friends', () => {
  const seed = makeSeed(), npc = seed.records.find(row => row.domain === 'npc'); if (npc?.domain !== 'npc') throw Error('fixture');
  const snapshot = { head: seed.head, records: seed.records, contentRefs: [] };
  for (let i = 0; i < 4; i++) {
    snapshot.records.push({ ...structuredClone(npc), entityId: `friend-${i}`, value: { ...structuredClone(npc.value), id: `friend-${i}`, travelingTogether: false, affinity: NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD + 1 } });
    snapshot.records.push({ scope: seed.head.scope, domain: 'courier', entityId: `friend-contact-${i}`, version: 1, value: { kind: 'contact', npcId: `friend-${i}`, name: `朋友${i}`, remark: '', available: true } });
  }
  const post = { kind: 'moment' as const, authorId: seed.playerId, sourceRef: seed.sources[0]!.ref, imageAssetIds: [], mentionedNpcIds: ['npc-amber'], visibilityNpcIds: ['npc-amber', ...Array.from({ length: 4 }, (_, i) => `friend-${i}`)] };
  expect(selectCoreMomentResponders(snapshot, 'post', post)).toHaveLength(4);
  expect(selectCoreMomentResponders(snapshot, 'post', post)).toContain('npc-amber');
  expect(selectCoreMomentResponders(snapshot, 'post', { ...post, visibilityNpcIds: [] })).toEqual([]);
});

it('includes visible party members below 100 and selects three distinct >=100 friends without repeating the prior trio', () => {
  const seed = makeSeed(), npc = seed.records.find(row => row.domain === 'npc'); if (npc?.domain !== 'npc') throw Error('fixture');
  const snapshot = { head: seed.head, records: seed.records, contentRefs: [] };
  for (let i = 0; i < 5; i++) {
    snapshot.records.push({ ...structuredClone(npc), entityId: `friend-${i}`, value: { ...structuredClone(npc.value), id: `friend-${i}`, travelingTogether: false, affinity: 100 } });
    snapshot.records.push({ scope: seed.head.scope, domain: 'courier', entityId: `friend-contact-${i}`, version: 1, value: { kind: 'contact', npcId: `friend-${i}`, name: `朋友${i}`, remark: '', available: true } });
  }
  const post = { kind: 'moment' as const, authorId: seed.playerId, sourceRef: seed.sources[0]!.ref, imageAssetIds: [], mentionedNpcIds: [] as string[], visibilityNpcIds: ['npc-amber', ...Array.from({ length: 5 }, (_, i) => `friend-${i}`)] };
  const selected = selectCoreMomentResponders(snapshot, 'same-post', post); expect(selected).toHaveLength(4); expect(selected).toContain('npc-amber');
  const prior = selected.filter(id => id !== 'npc-amber'), next = selectCoreMomentResponders(snapshot, 'same-post', post, prior);
  expect(next).toHaveLength(4); expect([...next].sort()).not.toEqual([...selected].sort());
  expect(selectCoreMomentResponders(snapshot, 'invisible-team', { ...post, visibilityNpcIds: [] })).toEqual([]);
});
