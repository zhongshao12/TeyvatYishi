import { describe, expect, it } from 'vitest';
import { classifyDoudizhuPlay, canBeatDoudizhuPlay } from '../../services/doudizhu/rules';
import { startDoudizhuGame } from '../../services/doudizhu/game';
import {
  chooseDoudizhuNpcMove,
  createDoudizhuNpcView,
  describeDoudizhuNpcMove,
  type DoudizhuNpcView,
} from '../../services/doudizhu/strategy';

const card = (rank: number, suit = 0) => (rank - 3) * 4 + suit;
const profile = (affinity: number, personality = '热情活泼，喜欢帮助朋友', speechStyle = '语气轻快') =>
  ({ id: 'amber-id', affinity, personality, speechStyle });

describe('offline Dou Dizhu NPC decisions', () => {
  it('exposes only its own hand and public information', () => {
    const game = startDoudizhuGame(['amber-id', 'lisa-id'], 42, 'g');
    const view = createDoudizhuNpcView({ ...game, activeSeat: 1 }, 1);
    expect(view.hand).toEqual(game.hands[1]);
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(game.hands[0]));
    expect(JSON.stringify(view)).not.toContain(JSON.stringify(game.hands[2]));
    expect('hands' in view).toBe(false);
  });

  it('always returns a legal move against an awkward trick and is deterministic', () => {
    const hand = [card(3), card(3, 1), card(4), card(5), card(5, 1), card(5, 2), 52, 53];
    const trick = { seat: 2 as const, cards: [card(4, 1), card(4, 2)], pattern: classifyDoudizhuPlay([card(4, 1), card(4, 2)])! };
    const view: DoudizhuNpcView = {
      seat: 1, hand, phase: 'playing', landlord: 2, activeSeat: 1,
      highestBid: 2, bids: [0, 1, 2], trick, publicLog: [], seed: 12, redeals: 0,
    };
    const first = chooseDoudizhuNpcMove(view, profile(40));
    expect(first).toEqual(chooseDoudizhuNpcMove(view, profile(40)));
    expect(first.type).toBe('play');
    if (first.type === 'play') {
      expect(first.cards.every((id) => hand.includes(id))).toBe(true);
      expect(canBeatDoudizhuPlay(classifyDoudizhuPlay(first.cards)!, trick.pattern)).toBe(true);
    }
  });

  it('uses affinity to avoid overtaking the player teammate when trust is high', () => {
    const trick = { seat: 0 as const, cards: [card(5)], pattern: classifyDoudizhuPlay([card(5)])! };
    const view: DoudizhuNpcView = {
      seat: 1, hand: [card(6), card(9)], phase: 'playing', landlord: 2, activeSeat: 1,
      highestBid: 1, bids: [0, 0, 1], trick, publicLog: [], seed: 9, redeals: 0,
    };
    expect(chooseDoudizhuNpcMove(view, profile(120)).type).toBe('pass');
    expect(chooseDoudizhuNpcMove(view, profile(0))).toMatchObject({ type: 'play', cards: [card(6)] });
  });

  it('uses the public teammate card count to distinguish medium and high trust against an opponent', () => {
    const trick = { seat: 2 as const, cards: [card(5)], pattern: classifyDoudizhuPlay([card(5)])! };
    const view: DoudizhuNpcView = {
      seat: 1, hand: [card(6), card(9)], phase: 'playing', landlord: 2, activeSeat: 1,
      highestBid: 2, bids: [0, 1, 2], trick, publicLog: [{ type: 'play', seat: 0, cards: [card(3)] }], seed: 9, redeals: 0,
      handCounts: [1, 2, 5],
    };
    expect(chooseDoudizhuNpcMove(view, profile(50))).toMatchObject({ type: 'play', cards: [card(6)] });
    expect(chooseDoudizhuNpcMove(view, profile(120))).toMatchObject({ type: 'play', cards: [card(9)] });
  });

  it('bids and leads legally even with no outside API', () => {
    const view: DoudizhuNpcView = {
      seat: 2, hand: [card(3), card(4), card(5)], phase: 'bidding', landlord: null,
      activeSeat: 2, highestBid: 0, bids: [0, 0, null], trick: null, publicLog: [], seed: 77, redeals: 0,
    };
    const bid = chooseDoudizhuNpcMove(view, profile(50));
    expect(bid.type).toBe('bid');
    if (bid.type === 'bid') expect([0, 1, 2, 3]).toContain(bid.points);
    const lead = chooseDoudizhuNpcMove({ ...view, phase: 'playing', landlord: 0, trick: null }, profile(50));
    expect(lead.type).toBe('play');
    if (lead.type === 'play') expect(classifyDoudizhuPlay(lead.cards)).not.toBeNull();
  });

  it('keeps persona lines bounded and distinct for different styles', () => {
    const move = { type: 'pass' as const, seat: 1 as const };
    const bright = describeDoudizhuNpcMove(move, profile(70));
    const reserved = describeDoudizhuNpcMove(move, profile(70, '严谨冷静的骑士团代理团长', '用词正式克制'));
    expect(bright).not.toBe(reserved);
    expect(bright.length).toBeLessThan(90);
    expect(reserved.length).toBeLessThan(90);
    expect(bright).not.toMatch(/时间不等人|约定的事别忘/);
  });
});
