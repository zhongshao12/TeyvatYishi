import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '../../models/teyvat';
import { createEmptyDoudizhuState, normalizeDoudizhuState } from '../../models/teyvat/doudizhu';
import { applyDoudizhuMove, startDoudizhuGame } from '../../services/doudizhu/game';

const start = () => startDoudizhuGame(['amber-id', 'lisa-id'], 123456, 'game-1');
const bidToPlay = () => {
  let game = start();
  game = applyDoudizhuMove(game, { type: 'bid', seat: 0, points: 1 });
  game = applyDoudizhuMove(game, { type: 'bid', seat: 1, points: 0 });
  game = applyDoudizhuMove(game, { type: 'bid', seat: 2, points: 0 });
  return game;
};

describe('Dou Dizhu persisted game state', () => {
  it('deals 17/17/17 plus three bottom cards reproducibly', () => {
    const game = start();
    expect(game.hands.map((hand) => hand.length)).toEqual([17, 17, 17]);
    expect(game.bottom).toHaveLength(3);
    expect(new Set([...game.hands.flat(), ...game.bottom]).size).toBe(54);
    expect(startDoudizhuGame(['amber-id', 'lisa-id'], 123456, 'game-1')).toEqual(game);
    expect(startDoudizhuGame(['amber-id', 'lisa-id'], 123457, 'game-1').hands).not.toEqual(game.hands);
  });

  it('gives the landlord the bottom and starts play at the landlord seat', () => {
    const game = bidToPlay();
    expect(game.phase).toBe('playing');
    expect(game.landlord).toBe(0);
    expect(game.activeSeat).toBe(0);
    expect(game.hands.map((hand) => hand.length)).toEqual([20, 17, 17]);
    expect(game.bottom.every((id) => game.hands[0].includes(id))).toBe(true);
  });

  it('redeals once after all pass and never auto-loops forever', () => {
    let game = start();
    for (const seat of [0, 1, 2] as const) game = applyDoudizhuMove(game, { type: 'bid', seat, points: 0 });
    expect(game.phase).toBe('bidding');
    expect(game.redeals).toBe(1);
    expect(game.bids).toEqual([null, null, null]);
    expect(game.hands).not.toEqual(start().hands);
  });

  it('validates turn order, bid escalation, plays, and two-pass reset', () => {
    let game = start();
    expect(() => applyDoudizhuMove(game, { type: 'bid', seat: 1, points: 1 })).toThrow();
    game = applyDoudizhuMove(game, { type: 'bid', seat: 0, points: 1 });
    expect(() => applyDoudizhuMove(game, { type: 'bid', seat: 1, points: 1 })).toThrow();
    game = applyDoudizhuMove(game, { type: 'bid', seat: 1, points: 0 });
    game = applyDoudizhuMove(game, { type: 'bid', seat: 2, points: 0 });
    expect(() => applyDoudizhuMove(game, { type: 'pass', seat: 0 })).toThrow();
    const first = game.hands[0][0]!;
    game = applyDoudizhuMove(game, { type: 'play', seat: 0, cards: [first] });
    expect(game.played).toContain(first);
    expect(game.activeSeat).toBe(1);
    expect(() => applyDoudizhuMove(game, { type: 'play', seat: 1, cards: [first] })).toThrow();
    game = applyDoudizhuMove(game, { type: 'pass', seat: 1 });
    game = applyDoudizhuMove(game, { type: 'pass', seat: 2 });
    expect(game.activeSeat).toBe(0);
    expect(game.trick).toBeNull();
    expect(game.passCount).toBe(0);
  });

  it('finishes when landlord or farmer empties a hand', () => {
    for (const winnerSeat of [0, 1] as const) {
      const base = bidToPlay();
      const sole = base.hands[winnerSeat][0]!;
      const hands = base.hands.map((hand) => [...hand]) as typeof base.hands;
      const moved = hands[winnerSeat].splice(1);
      hands[winnerSeat === 0 ? 1 : 0].push(...moved);
      const game = { ...base, hands, activeSeat: winnerSeat, trick: null, passCount: 0 };
      const finished = applyDoudizhuMove(game, { type: 'play', seat: winnerSeat, cards: [sole] });
      expect(finished.phase).toBe('finished');
      expect(finished.result?.winningSide).toBe(winnerSeat === 0 ? 'landlord' : 'farmers');
      expect(finished.result?.winnerSeat).toBe(winnerSeat);
    }
  });

  it('adds an empty slice to old saves without changing world time', () => {
    const old = createEmptyTeyvatGameState();
    old.世界.当前时间 = '18:00';
    const { 斗地主: _removed, ...withoutSlice } = old;
    const loaded = normalizeTeyvatGameState(withoutSlice);
    expect(loaded.斗地主).toEqual(createEmptyDoudizhuState());
    expect(loaded.世界).toEqual(old.世界);
    expect(loaded.schemaVersion).toBe(2);
  });

  it('restores valid mid-game state but rejects corrupt hands and seats', () => {
    const game = bidToPlay();
    expect(normalizeDoudizhuState({ currentGame: game }).currentGame).toEqual(game);
    const duplicate = { ...game, hands: [[...game.hands[0], game.hands[1][0]], game.hands[1], game.hands[2]] };
    expect(normalizeDoudizhuState({ currentGame: duplicate }).currentGame).toBeNull();
    expect(normalizeDoudizhuState({ currentGame: duplicate }).lastError).toMatch(/损坏|无效/);
    expect(normalizeDoudizhuState({ currentGame: { ...game, activeSeat: 3 } }).currentGame).toBeNull();
  });

  it('rejects card-conserving but unreachable hands and malformed public actions', () => {
    const game = bidToPlay();
    const forged = {
      ...game,
      hands: [[game.hands[0][0]!], game.hands[1], game.hands[2]] as typeof game.hands,
      played: game.hands[0].slice(1),
    };
    expect(normalizeDoudizhuState({ currentGame: forged }).currentGame).toBeNull();
    const malformed = { ...game, publicLog: [...game.publicLog, { seat: 1, type: 'play', cards: 'not-cards' }] };
    expect(normalizeDoudizhuState({ currentGame: malformed }).currentGame).toBeNull();
  });
});
