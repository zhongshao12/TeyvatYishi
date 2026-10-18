import { afterEach, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { commitCorpusTurn } from './coreSessionHarness';
import { openCorpusSession } from './nodeCorpusSession';

const previous: IDBFactory | undefined = globalThis.indexedDB;
afterEach(() => { if (previous) globalThis.indexedDB = previous; });

it('commits deterministic corpus turns through the real repository protocol', async () => {
  // fake-indexeddb instances are passed explicitly; the global stays untouched for other suites.
  const session = await openCorpusSession(`test-core2-harness-${crypto.randomUUID()}`);
  expect(session.head.coreSeq).toBe(0);
  await commitCorpusTurn(session, { turn: 1, events: [{
    eventId: 'event-0001-0', type: 'inventory.gain', actors: ['npc-amber'], targets: ['apple'],
    text: '第1回合：安柏在蒙德城把第1枚苹果递给旅人。', location: '蒙德城',
    visibility: { kind: 'public', npcIds: [] }, knowledge: ['witnessed'], knowledgeNpcIds: ['npc-amber'],
  }] });
  await commitCorpusTurn(session, { turn: 2, events: [{
    eventId: 'event-0002-0', type: 'explore', actors: ['npc-kaeya'], targets: [],
    text: '第2回合：凯亚在风起地记录第2次巡逻路线。', location: '风起地',
    visibility: { kind: 'public', npcIds: [] }, knowledge: ['witnessed'], knowledgeNpcIds: ['npc-kaeya'],
  }] });
  expect(session.head.coreSeq).toBe(2);
  const events = (await session.repo.queryEvents({ scope: session.scope, cutoffSeq: session.head.coreSeq })).items;
  expect(events.map(event => event.eventId).sort()).toEqual(['event-0001-0', 'event-0002-0']);
  expect(events.every(event => event.commitSeq > 0)).toBe(true);
  const knowledge = (await session.repo.queryKnowledge({ scope: session.scope, cutoffSeq: session.head.coreSeq })).items;
  expect(knowledge.map(row => row.npcId).sort()).toEqual(['npc-amber', 'npc-kaeya']);
  expect(knowledge.every(row => row.mode === 'witnessed' && row.nature === 'fact')).toBe(true);
});
