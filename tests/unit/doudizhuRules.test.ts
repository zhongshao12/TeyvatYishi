import { describe, expect, it } from 'vitest';
import {
  canBeatDoudizhuPlay,
  classifyDoudizhuPlay,
  listLegalDoudizhuPlays,
  rankOfCard,
} from '../../services/doudizhu/rules';

const card = (rank: number, suit = 0) => (rank - 3) * 4 + suit;
const group = (rank: number, count: number) => Array.from({ length: count }, (_, suit) => card(rank, suit));
const chain = (first: number, length: number, copies = 1) =>
  Array.from({ length }, (_, offset) => group(first + offset, copies)).flat();

describe('Dou Dizhu card rules', () => {
  it('maps all 54 distinct cards to ordered ranks', () => {
    expect([rankOfCard(0), rankOfCard(47), rankOfCard(48), rankOfCard(52), rankOfCard(53)])
      .toEqual([3, 14, 15, 16, 17]);
    expect(rankOfCard(-1)).toBeNaN();
    expect(rankOfCard(54)).toBeNaN();
  });

  it.each([
    ['single', [card(3)], 'single', 3, 1, 1],
    ['pair', group(4, 2), 'pair', 4, 2, 1],
    ['triple', group(5, 3), 'triple', 5, 3, 1],
    ['triple with single', [...group(5, 3), card(6)], 'tripleSingle', 5, 4, 1],
    ['triple with pair', [...group(5, 3), ...group(6, 2)], 'triplePair', 5, 5, 1],
    ['straight', chain(3, 5), 'straight', 7, 5, 5],
    ['pair straight', chain(3, 3, 2), 'pairStraight', 5, 6, 3],
    ['airplane', chain(3, 2, 3), 'airplane', 4, 6, 2],
    ['airplane singles', [...chain(3, 2, 3), card(6), card(7)], 'airplaneSingles', 4, 8, 2],
    ['airplane pairs', [...chain(3, 2, 3), ...group(6, 2), ...group(7, 2)], 'airplanePairs', 4, 10, 2],
    ['four with singles', [...group(3, 4), card(4), card(5)], 'fourSingles', 3, 6, 1],
    ['four with pairs', [...group(3, 4), ...group(4, 2), ...group(5, 2)], 'fourPairs', 3, 8, 1],
    ['bomb', group(9, 4), 'bomb', 9, 4, 1],
    ['rocket', [52, 53], 'rocket', 17, 2, 1],
  ] as const)('classifies %s', (_label, cards, kind, mainRank, cardCount, chainLength) => {
    expect(classifyDoudizhuPlay(cards)).toEqual({ kind, mainRank, cardCount, chainLength });
  });

  it.each([
    [chain(3, 4), 'short straight'],
    [chain(12, 5), 'straight containing 2'],
    [chain(14, 3, 2), 'pair straight containing 2'],
    [chain(14, 2, 3), 'airplane containing 2'],
    [[...chain(3, 2, 3), card(3, 3), card(7)], 'airplane reusing a body rank as a wing'],
    [[...group(3, 4), ...group(4, 2), ...group(5, 2), card(6)], 'extra card'],
    [[card(3), card(3)], 'duplicate ID'],
    [[-1], 'out-of-range ID'],
  ] as const)('rejects %s (%s)', (cards, _label) => {
    expect(classifyDoudizhuPlay(cards)).toBeNull();
  });

  it('compares only compatible shapes, except bombs and rocket', () => {
    const pair4 = classifyDoudizhuPlay(group(4, 2))!;
    const pair5 = classifyDoudizhuPlay(group(5, 2))!;
    const single5 = classifyDoudizhuPlay([card(5)])!;
    const bomb3 = classifyDoudizhuPlay(group(3, 4))!;
    const bomb4 = classifyDoudizhuPlay(group(4, 4))!;
    const rocket = classifyDoudizhuPlay([52, 53])!;
    expect(canBeatDoudizhuPlay(pair5, pair4)).toBe(true);
    expect(canBeatDoudizhuPlay(pair4, pair5)).toBe(false);
    expect(canBeatDoudizhuPlay(single5, pair4)).toBe(false);
    expect(canBeatDoudizhuPlay(bomb3, pair4)).toBe(true);
    expect(canBeatDoudizhuPlay(bomb4, bomb3)).toBe(true);
    expect(canBeatDoudizhuPlay(rocket, bomb4)).toBe(true);
    expect(canBeatDoudizhuPlay(bomb4, rocket)).toBe(false);
    expect(canBeatDoudizhuPlay(classifyDoudizhuPlay(chain(4, 5))!, classifyDoudizhuPlay(chain(3, 6))!)).toBe(false);
  });

  it('enumerates legal plays from a 20-card hand without inventing cards', () => {
    const hand = [...group(3, 4), ...group(4, 3), ...group(5, 3), ...group(6, 2), ...group(7, 2), ...group(8, 2), card(9), card(10), 52, 53];
    const target = classifyDoudizhuPlay(group(4, 2))!;
    const plays = listLegalDoudizhuPlays(hand, target);
    expect(hand).toHaveLength(20);
    expect(plays.some((play) => play.length === 2 && play.includes(52) && play.includes(53))).toBe(true);
    expect(plays.some((play) => play.length === 2 && play.every((id) => rankOfCard(id) === 5))).toBe(true);
    expect(plays.every((play) => play.every((id) => hand.includes(id)))).toBe(true);
    expect(plays.every((play) => canBeatDoudizhuPlay(classifyDoudizhuPlay(play)!, target))).toBe(true);
    expect(listLegalDoudizhuPlays([card(3), card(3)])).toEqual([]);
  });
});
