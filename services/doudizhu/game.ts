import type { DoudizhuGame, DoudizhuMove, DoudizhuSeat } from '../../models/teyvat/doudizhu';
import { isValidDoudizhuGame } from '../../models/teyvat/doudizhu';
import { canBeatDoudizhuPlay, classifyDoudizhuPlay } from './rules';

export class DoudizhuGameError extends Error {}

const nextSeat = (seat: DoudizhuSeat): DoudizhuSeat => ((seat + 1) % 3) as DoudizhuSeat;
const boundedLog = (game: DoudizhuGame, entry: DoudizhuGame['publicLog'][number]) => [...game.publicLog, entry].slice(-180);

function shuffle(seed: number): number[] {
  let value = (seed >>> 0) || 0x6d2b79f5;
  const cards = Array.from({ length: 54 }, (_, index) => index);
  for (let index = cards.length - 1; index > 0; index -= 1) {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    const swap = (value >>> 0) % (index + 1);
    [cards[index], cards[swap]] = [cards[swap]!, cards[index]!];
  }
  return cards;
}

export function startDoudizhuGame(npcIds: readonly [string, string], seed: number, gameId: string): DoudizhuGame {
  if (!npcIds[0] || !npcIds[1] || npcIds[0] === npcIds[1] || !gameId || !Number.isInteger(seed)) {
    throw new DoudizhuGameError('请选择两位不同的同伴，才能开始牌局。');
  }
  const deck = shuffle(seed);
  const hands: DoudizhuGame['hands'] = [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)];
  return {
    id: gameId,
    npcIds: [npcIds[0], npcIds[1]],
    seed,
    redeals: 0,
    hands,
    bottom: deck.slice(51),
    played: [],
    phase: 'bidding',
    bids: [null, null, null],
    highestBid: 0,
    landlord: null,
    activeSeat: 0,
    trick: null,
    passCount: 0,
    publicLog: [],
    result: null,
    settled: false,
  };
}

export function applyDoudizhuMove(game: DoudizhuGame, move: DoudizhuMove): DoudizhuGame {
  if (!isValidDoudizhuGame(game)) throw new DoudizhuGameError('牌局数据损坏，无法继续出牌。');
  if (game.phase === 'finished') throw new DoudizhuGameError('这局已经结束。');
  if (game.activeSeat !== move.seat) throw new DoudizhuGameError('还没有轮到这位玩家。');

  if (game.phase === 'bidding') {
    if (move.type !== 'bid' || !Number.isInteger(move.points) || move.points < 0 || move.points > 3) {
      throw new DoudizhuGameError('请先叫分。');
    }
    if (move.points !== 0 && move.points <= game.highestBid) throw new DoudizhuGameError('叫分必须高于当前最高分。');
    const bids = [...game.bids] as DoudizhuGame['bids'];
    bids[move.seat] = move.points;
    const publicLog = boundedLog(game, { type: 'bid', seat: move.seat, points: move.points });
    const highestBid = Math.max(game.highestBid, move.points);
    if (move.points === 3 || bids.every((points) => points !== null)) {
      if (highestBid === 0) {
        const redeals = game.redeals + 1;
        const nextSeed = (Math.imul(game.seed ^ redeals, 1664525) + 1013904223) | 0;
        return { ...startDoudizhuGame(game.npcIds, nextSeed, game.id), redeals };
      }
      const landlord = bids.findIndex((points) => points === highestBid) as DoudizhuSeat;
      const hands = game.hands.map((hand) => [...hand]) as DoudizhuGame['hands'];
      hands[landlord].push(...game.bottom);
      return { ...game, bids, highestBid, hands, landlord, phase: 'playing', activeSeat: landlord, publicLog };
    }
    return { ...game, bids, highestBid, activeSeat: nextSeat(move.seat), publicLog };
  }

  if (move.type === 'bid') throw new DoudizhuGameError('叫分阶段已经结束。');
  if (move.type === 'pass') {
    if (!game.trick) throw new DoudizhuGameError('领出时不能不要。');
    if (game.trick.seat === move.seat) throw new DoudizhuGameError('不能不要自己的出牌。');
    const passCount = game.passCount + 1;
    return {
      ...game,
      activeSeat: nextSeat(move.seat),
      trick: passCount >= 2 ? null : game.trick,
      passCount: passCount >= 2 ? 0 : passCount,
      publicLog: boundedLog(game, { type: 'pass', seat: move.seat }),
    };
  }
  if (move.type !== 'play' || !Array.isArray(move.cards) || move.cards.length === 0 || new Set(move.cards).size !== move.cards.length) {
    throw new DoudizhuGameError('请选择有效的牌。');
  }
  const hand = game.hands[move.seat];
  if (!move.cards.every((id) => hand.includes(id))) throw new DoudizhuGameError('选中的牌不在手牌中。');
  const pattern = classifyDoudizhuPlay(move.cards);
  if (!pattern) throw new DoudizhuGameError('选中的牌不构成合法牌型。');
  if (game.trick && !canBeatDoudizhuPlay(pattern, game.trick.pattern)) throw new DoudizhuGameError('这手牌压不过桌面牌。');
  const hands = game.hands.map((cards) => [...cards]) as DoudizhuGame['hands'];
  const playedCards = new Set(move.cards);
  hands[move.seat] = hands[move.seat].filter((id) => !playedCards.has(id));
  const finished = hands[move.seat].length === 0;
  const landlord = game.landlord!;
  const publicLog = boundedLog(game, { type: 'play', seat: move.seat, cards: [...move.cards] });
  const result = finished ? {
    winningSide: move.seat === landlord ? 'landlord' as const : 'farmers' as const,
    winnerSeat: move.seat,
    spring: move.seat === landlord
      ? !publicLog.some((entry) => entry.type === 'play' && entry.seat !== landlord)
      : publicLog.filter((entry) => entry.type === 'play' && entry.seat === landlord).length <= 1,
  } : null;
  return {
    ...game,
    hands,
    played: [...game.played, ...move.cards],
    phase: finished ? 'finished' : 'playing',
    activeSeat: finished ? move.seat : nextSeat(move.seat),
    trick: { seat: move.seat, cards: [...move.cards], pattern },
    passCount: 0,
    publicLog,
    result,
  };
}

/** Replay every public action from the seeded deal. The log bound exceeds a game's
 * maximum possible three-seat actions (54 plays plus at most two passes per play). */
export function isReachableDoudizhuGame(game: DoudizhuGame): boolean {
  if (!isValidDoudizhuGame(game)) return false;
  try {
    let replay: DoudizhuGame = { ...startDoudizhuGame(game.npcIds, game.seed, game.id), redeals: game.redeals };
    for (const entry of game.publicLog) {
      const move: DoudizhuMove = entry.type === 'bid'
        ? { type: 'bid', seat: entry.seat, points: entry.points as 0 | 1 | 2 | 3 }
        : entry.type === 'play'
          ? { type: 'play', seat: entry.seat, cards: entry.cards! }
          : { type: 'pass', seat: entry.seat };
      replay = applyDoudizhuMove(replay, move);
      if (replay.redeals !== game.redeals) return false;
    }
    return JSON.stringify({ ...replay, settled: game.settled }) === JSON.stringify(game);
  } catch {
    return false;
  }
}
