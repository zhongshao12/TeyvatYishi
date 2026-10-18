import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { listLegalDoudizhuPlays } from '@/services/doudizhu/rules';
import { makeSeed } from './fixtures';
import type { DoudizhuMove } from '@/models/teyvat/doudizhu';

async function fixture() {
  const seed = makeSeed(), amber = seed.records.find(row => row.domain === 'npc'); if (amber?.domain !== 'npc') throw Error('fixture');
  const world = seed.records.find(row => row.domain === 'world'); if (world?.domain === 'world') world.value.moment.turn = world.value.completedMainTurns;
  seed.records.push({ ...structuredClone(amber), entityId: 'npc-lisa', value: { ...structuredClone(amber.value), id: 'npc-lisa', 姓名: '丽莎', travelingTogether: false, affinity: 100, personality: '慵懒、喜欢调侃' } });
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-doudizhu-runtime-${crypto.randomUUID()}` }), generateNarrative = vi.fn(), factModel = vi.fn();
  const controller = createCoreController({ repo, turnDependencies: () => ({ generateNarrative, factModel, assembleContext: async () => ({ systemPrompt: '', messages: [] }), rulePolicy: { ruleVersion: 'test', storyNodes: [] } }) });
  await controller.initialize(seed);
  const game = () => controller.getView().snapshot!.records.find(row => row.domain === 'doudizhu')!;
  return { seed, repo, controller, game, generateNarrative, factModel };
}
it('plays a complete local three-person game, atomically adds +5 once, and records it only for the participants', async () => {
  const f = await fixture(); await f.controller.command({ type: 'doudizhu_start', npcIds: ['npc-amber', 'npc-lisa'], seed: 42, gameId: 'game-42' });
  let last: Awaited<ReturnType<typeof f.controller.command>> | undefined;
  for (let count = 0; count < 150; count++) {
    const row = f.game(); if (row.domain !== 'doudizhu' || !row.value.currentGame) throw Error('fixture');
    const current = row.value.currentGame; if (current.phase === 'finished') break;
    expect(current.activeSeat).toBe(0);
    const legal = current.phase === 'playing' ? listLegalDoudizhuPlays(current.hands[0], current.trick?.pattern) : [];
    const move: DoudizhuMove = current.phase === 'bidding' ? { type: 'bid', seat: 0, points: 3 } : legal.length ? { type: 'play', seat: 0, cards: legal[0]! } : { type: 'pass', seat: 0 };
    last = await f.controller.command({ type: 'doudizhu_turn', gameId: current.id, expectedVersion: row.version, move });
  }
  expect(f.game()).toMatchObject({ value: { currentGame: { phase: 'finished', settled: true } } }); await f.controller.waitForBackground();
  const state = await f.repo.readState(f.seed.head.scope);
  expect(state.records.filter(row => row.domain === 'npc').map(row => row.value.affinity)).toEqual([15, 105]);
  const events = (await f.repo.queryEvents({ scope: state.head.scope, cutoffSeq: state.head.coreSeq, types: ['game.doudizhu.completed'] })).items;
  expect(events).toHaveLength(1); expect(events[0]!.fact).toMatchObject({ kind: 'experience', participantIds: [f.seed.playerId, 'npc-amber', 'npc-lisa'], description: expect.stringContaining('斗地主') });
  const knowledge = (await f.repo.queryKnowledge({ scope: state.head.scope, cutoffSeq: state.head.coreSeq, eventIds: [events[0]!.eventId] })).items;
  expect(knowledge.map(row => row.npcId).sort()).toEqual(['npc-amber', 'npc-lisa']);
  expect((await f.repo.queryJobs({ scope: state.head.scope, cutoffSeq: state.head.coreSeq })).items.map(row => ({ status: row.status, failure: row.failure }))).toEqual([{ status: 'completed', failure: undefined }]);
  expect(state.head.memoryRevision).toBe(1); expect(last?.jobIds).toHaveLength(1);
  expect((await f.repo.queryMemories({ scope: state.head.scope, cutoffSeq: state.head.coreSeq, memoryRevision: state.head.memoryRevision })).items[0]!.turns).toEqual([0]);
  expect(state.records.find(row => row.domain === 'world')).toMatchObject({ value: { completedMainTurns: 0, moment: f.seed.records.find(row => row.domain === 'world')!.value.moment } });
  expect(f.generateNarrative).not.toHaveBeenCalled(); expect(f.factModel).not.toHaveBeenCalled();
});
it('abandons without a reward and rejects a stale or non-player move without changing the game', async () => {
  const f = await fixture(); await f.controller.command({ type: 'doudizhu_start', npcIds: ['npc-amber', 'npc-lisa'], seed: 42, gameId: 'abandon-42' });
  const row = f.game();
  await expect(f.controller.command({ type: 'doudizhu_turn', gameId: 'abandon-42', expectedVersion: row.version - 1, move: { type: 'bid', seat: 0, points: 3 } })).rejects.toThrow('牌局已更新');
  await expect(f.controller.command({ type: 'doudizhu_turn', gameId: 'abandon-42', expectedVersion: row.version, move: { type: 'bid', seat: 1, points: 3 } })).rejects.toThrow('只能操作自己的手牌');
  expect(f.game()).toEqual(row);
  await f.controller.command({ type: 'doudizhu_abandon', gameId: 'abandon-42', expectedVersion: row.version });
  expect(f.game()).toMatchObject({ value: { currentGame: null } });
  expect(f.controller.getView().snapshot!.records.filter(record => record.domain === 'npc').map(record => record.value.affinity)).toEqual([10, 100]);
});
