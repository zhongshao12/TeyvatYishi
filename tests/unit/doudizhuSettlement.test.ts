import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState, normalizeTeyvatNpcRecords } from '../../models/teyvat';
import type { DoudizhuGame } from '../../models/teyvat/doudizhu';
import { applyDoudizhuMove, startDoudizhuGame } from '../../services/doudizhu/game';
import { applyDoudizhuGameAction } from '../../services/doudizhu/settlement';
import { 提取好感变化事件 } from '../../utils/relationshipGraph';
import { toLegacyVariableBatches } from '../../hooks/useGameState';

const npcIds = ['npc-a', 'npc-b'] as const;
const root = (affinityA = 20, affinityB = 20) => {
  const state = createEmptyTeyvatGameState();
  state.旅行者.姓名 = '云';
  state.NPC = normalizeTeyvatNpcRecords([
    { id: npcIds[0], 姓名: '甲', affinity: affinityA, roleTier: 'companion' },
    { id: npcIds[1], 姓名: '乙', affinity: affinityB, roleTier: 'companion' },
  ]);
  state.turnCount = 9;
  return state;
};

const nearFinish = (winner: 0 | 1): DoudizhuGame => {
  let game = startDoudizhuGame(npcIds, 5, `game-${winner}`);
  game = applyDoudizhuMove(game, { type: 'bid', seat: 0, points: 1 });
  game = applyDoudizhuMove(game, { type: 'bid', seat: 1, points: 0 });
  game = applyDoudizhuMove(game, { type: 'bid', seat: 2, points: 0 });
  const deck = game.hands.flat();
  const low = deck.find((id) => id < 4)!;
  const high = deck.find((id) => id === 53)!;
  const third = deck.find((id) => id !== low && id !== high)!;
  const spare = deck.find((id) => id !== low && id !== high && id !== third)!;
  return {
    ...game,
    hands: [winner === 0 ? [low] : [low, spare], [high], [third]],
    played: deck.filter((id) => id !== low && id !== high && id !== third && (winner === 0 || id !== spare)),
    activeSeat: 0,
    trick: null,
    passCount: 0,
    publicLog: [],
  };
};

describe('Dou Dizhu atomic settlement', () => {
  it('awards both invited NPCs +5 and one actual-match memory, regardless of winner', () => {
    for (const winner of [0, 1] as const) {
      const state = root();
      state.斗地主.currentGame = nearFinish(winner);
      const card = state.斗地主.currentGame.hands[0][0]!;
      const settled = applyDoudizhuGameAction(state, { type: 'play', cards: [card] });
      expect(settled.斗地主.currentGame?.result?.winningSide).toBe(winner === 0 ? 'landlord' : 'farmers');
      expect(settled.NPC.map((npc) => npc.affinity)).toEqual([25, 25]);
      expect(settled.NPC.map((npc) => npc.sharedMemories.length)).toEqual([1, 1]);
      expect(settled.NPC[0]?.sharedMemories[0]?.summary).toMatch(/斗地主|地主|农民/);
      expect(settled.叙事.variableBatches.at(-1)?.source).toBe('doudizhu');
      expect(提取好感变化事件(toLegacyVariableBatches(settled.叙事.variableBatches)).map((event) => event.delta)).toEqual([5, 5]);
      expect(settled.世界).toBe(state.世界);
    }
  });

  it('replay, rapid click and reload cannot grant a second reward', () => {
    const state = root();
    state.斗地主.currentGame = nearFinish(0);
    const card = state.斗地主.currentGame.hands[0][0]!;
    const once = applyDoudizhuGameAction(state, { type: 'play', cards: [card] });
    const twice = applyDoudizhuGameAction(once, { type: 'play', cards: [card] });
    const reloaded = normalizeTeyvatGameState(JSON.parse(JSON.stringify(twice)));
    const thrice = applyDoudizhuGameAction(reloaded, { type: 'play', cards: [card] });
    expect(thrice.NPC.map((npc) => npc.affinity)).toEqual([25, 25]);
    expect(thrice.NPC.map((npc) => npc.sharedMemories.length)).toEqual([1, 1]);
    expect(thrice.叙事.variableBatches.filter((batch) => batch.source === 'doudizhu')).toHaveLength(1);
    expect(thrice.斗地主.settledGameIds).toEqual(['game-0']);
  });

  it('clamps at the existing affinity maximum and derives the relationship stage', () => {
    const state = root(149, 150);
    state.斗地主.currentGame = nearFinish(0);
    const settled = applyDoudizhuGameAction(state, { type: 'play', cards: [state.斗地主.currentGame.hands[0][0]!] });
    expect(settled.NPC.map((npc) => npc.affinity)).toEqual([150, 150]);
    expect(settled.NPC[0]?.relationshipLedger.currentStage).toBe('生死挚友');
    expect(提取好感变化事件(toLegacyVariableBatches(settled.叙事.variableBatches)).map((event) => event.delta)).toEqual([1, 0]);
  });

  it('never credits a same-name stranger when an invited ID disappears or is archived', () => {
    const state = root();
    state.斗地主.currentGame = nearFinish(0);
    const card = state.斗地主.currentGame.hands[0][0]!;
    state.NPC = [state.NPC[1]!, { ...state.NPC[0]!, id: 'impostor' }];
    const missing = applyDoudizhuGameAction(state, { type: 'play', cards: [card] });
    expect(missing.NPC).toBe(state.NPC);
    expect(missing.斗地主.lastError).toMatch(/同伴|归档|找不到/);
    const archivedState = root();
    archivedState.斗地主.currentGame = nearFinish(0);
    archivedState.NPC[1] = { ...archivedState.NPC[1]!, archived: true };
    const archived = applyDoudizhuGameAction(archivedState, { type: 'play', cards: [card] });
    expect(archived.NPC).toBe(archivedState.NPC);
    expect(archived.叙事.variableBatches).toHaveLength(0);
  });

  it('rejects corrupted games and abandoning unfinished games pays nothing', () => {
    const state = root();
    state.斗地主.currentGame = { ...nearFinish(0), activeSeat: 3 } as unknown as DoudizhuGame;
    const invalid = applyDoudizhuGameAction(state, { type: 'pass' });
    expect(invalid.NPC).toBe(state.NPC);
    expect(invalid.斗地主.lastError).toMatch(/损坏|无效/);
    const fresh = root();
    const invited = applyDoudizhuGameAction(fresh, { type: 'invite', npcIds: [...npcIds], seed: 3, gameId: 'g-new' });
    const abandoned = applyDoudizhuGameAction(invited, { type: 'abandon' });
    expect(abandoned.斗地主.currentGame).toBeNull();
    expect(abandoned.NPC.map((npc) => npc.affinity)).toEqual([20, 20]);
    expect(abandoned.叙事.variableBatches).toHaveLength(0);
  });
});
