export type DoudizhuPatternKind =
  | 'single' | 'pair' | 'triple' | 'tripleSingle' | 'triplePair'
  | 'straight' | 'pairStraight' | 'airplane' | 'airplaneSingles' | 'airplanePairs'
  | 'fourSingles' | 'fourPairs' | 'bomb' | 'rocket';

export interface DoudizhuPattern {
  kind: DoudizhuPatternKind;
  mainRank: number;
  cardCount: number;
  chainLength: number;
}

export const rankOfCard = (cardId: number): number => {
  if (!Number.isInteger(cardId) || cardId < 0 || cardId > 53) return Number.NaN;
  return cardId === 53 ? 17 : cardId === 52 ? 16 : Math.floor(cardId / 4) + 3;
};

const makePattern = (kind: DoudizhuPatternKind, mainRank: number, cardCount: number, chainLength = 1): DoudizhuPattern =>
  ({ kind, mainRank, cardCount, chainLength });

const consecutive = (ranks: readonly number[]): boolean =>
  ranks.length > 0 && ranks.at(-1)! <= 14 && ranks.every((rank, index) => index === 0 || rank === ranks[index - 1]! + 1);

export function classifyDoudizhuPlay(cards: readonly number[]): DoudizhuPattern | null {
  const n = cards.length;
  if (n === 0 || n > 20 || new Set(cards).size !== n || cards.some((card) => !Number.isFinite(rankOfCard(card)))) return null;
  const counts = new Map<number, number>();
  for (const card of cards) {
    const rank = rankOfCard(card);
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }
  const ranks = [...counts.keys()].sort((a, b) => a - b);
  const withCount = (count: number) => ranks.filter((rank) => counts.get(rank) === count);

  if (n === 1) return makePattern('single', ranks[0]!, n);
  if (n === 2) {
    if (counts.has(16) && counts.has(17)) return makePattern('rocket', 17, n);
    return withCount(2).length === 1 ? makePattern('pair', ranks[0]!, n) : null;
  }
  if (n === 3) return withCount(3).length === 1 ? makePattern('triple', ranks[0]!, n) : null;
  if (n === 4) {
    if (withCount(4).length === 1) return makePattern('bomb', ranks[0]!, n);
    if (withCount(3).length === 1) return makePattern('tripleSingle', withCount(3)[0]!, n);
  }
  if (n === 5 && withCount(3).length === 1 && withCount(2).length === 1) {
    return makePattern('triplePair', withCount(3)[0]!, n);
  }
  if (n === 6 && withCount(4).length === 1 && ranks.length >= 2) {
    return makePattern('fourSingles', withCount(4)[0]!, n);
  }
  if (n === 8 && withCount(4).length === 1 && withCount(2).length === 2) {
    return makePattern('fourPairs', withCount(4)[0]!, n);
  }
  if (n >= 5 && ranks.length === n && consecutive(ranks)) return makePattern('straight', ranks.at(-1)!, n, n);
  if (n >= 6 && n % 2 === 0 && ranks.length === n / 2 && ranks.every((rank) => counts.get(rank) === 2) && consecutive(ranks)) {
    return makePattern('pairStraight', ranks.at(-1)!, n, ranks.length);
  }

  const tryAirplane = (bodyLength: number, kind: DoudizhuPatternKind, wingSize: 0 | 1 | 2): DoudizhuPattern | null => {
    if (bodyLength < 2) return null;
    for (let first = 3; first + bodyLength - 1 <= 14; first += 1) {
      const body = Array.from({ length: bodyLength }, (_, index) => first + index);
      if (!body.every((rank) => (counts.get(rank) ?? 0) >= 3)) continue;
      const remainder = new Map(counts);
      for (const rank of body) remainder.set(rank, remainder.get(rank)! - 3);
      if (body.some((rank) => remainder.get(rank) !== 0)) continue;
      const wings = [...remainder.entries()].filter(([, count]) => count > 0);
      if (wingSize === 0 && wings.length === 0) return makePattern(kind, body.at(-1)!, n, bodyLength);
      if (wingSize === 1 && wings.reduce((sum, [, count]) => sum + count, 0) === bodyLength) {
        return makePattern(kind, body.at(-1)!, n, bodyLength);
      }
      if (wingSize === 2 && wings.length === bodyLength && wings.every(([, count]) => count === 2)) {
        return makePattern(kind, body.at(-1)!, n, bodyLength);
      }
    }
    return null;
  };

  if (n % 3 === 0) {
    const pattern = tryAirplane(n / 3, 'airplane', 0);
    if (pattern) return pattern;
  }
  if (n % 4 === 0) {
    const pattern = tryAirplane(n / 4, 'airplaneSingles', 1);
    if (pattern) return pattern;
  }
  if (n % 5 === 0) return tryAirplane(n / 5, 'airplanePairs', 2);
  return null;
}

export function canBeatDoudizhuPlay(candidate: DoudizhuPattern, target: DoudizhuPattern): boolean {
  if (candidate.kind === 'rocket') return target.kind !== 'rocket';
  if (target.kind === 'rocket') return false;
  if (candidate.kind === 'bomb' && target.kind !== 'bomb') return true;
  if (target.kind === 'bomb' && candidate.kind !== 'bomb') return false;
  return candidate.kind === target.kind
    && candidate.cardCount === target.cardCount
    && candidate.chainLength === target.chainLength
    && candidate.mainRank > target.mainRank;
}

const combinations = <T>(values: readonly T[], count: number, cap = 5000): T[][] => {
  const output: T[][] = [];
  const visit = (start: number, chosen: T[]) => {
    if (output.length >= cap) return;
    if (chosen.length === count) {
      output.push([...chosen]);
      return;
    }
    for (let index = start; index <= values.length - (count - chosen.length); index += 1) {
      visit(index + 1, [...chosen, values[index]!]);
    }
  };
  visit(0, []);
  return output;
};

export function listLegalDoudizhuPlays(hand: readonly number[], target?: DoudizhuPattern): number[][] {
  if (hand.length === 0 || hand.length > 20 || new Set(hand).size !== hand.length || hand.some((id) => !Number.isFinite(rankOfCard(id)))) return [];
  const byRank = new Map<number, number[]>();
  for (const id of [...hand].sort((a, b) => a - b)) {
    const rank = rankOfCard(id);
    byRank.set(rank, [...(byRank.get(rank) ?? []), id]);
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const output: number[][] = [];
  const seen = new Set<string>();
  const add = (cards: number[]) => {
    const sorted = [...cards].sort((a, b) => a - b);
    const key = sorted.join(',');
    if (seen.has(key)) return;
    const pattern = classifyDoudizhuPlay(sorted);
    if (!pattern || (target && !canBeatDoudizhuPlay(pattern, target))) return;
    seen.add(key);
    output.push(sorted);
  };
  const take = (rank: number, count: number) => byRank.get(rank)?.slice(0, count) ?? [];
  const ranksWith = (count: number) => ranks.filter((rank) => (byRank.get(rank)?.length ?? 0) >= count);
  for (const rank of ranks) add(take(rank, 1));
  for (const rank of ranksWith(2)) add(take(rank, 2));
  for (const rank of ranksWith(3)) {
    const body = take(rank, 3);
    add(body);
    for (const wing of ranks.filter((item) => item !== rank)) add([...body, ...take(wing, 1)]);
    for (const wing of ranksWith(2).filter((item) => item !== rank)) add([...body, ...take(wing, 2)]);
  }
  for (const rank of ranksWith(4)) {
    const body = take(rank, 4);
    add(body);
    const otherCards = hand.filter((id) => rankOfCard(id) !== rank);
    for (const wings of combinations(otherCards, 2)) add([...body, ...wings]);
    for (const wings of combinations(ranksWith(2).filter((item) => item !== rank), 2)) {
      add([...body, ...wings.flatMap((wing) => take(wing, 2))]);
    }
  }
  if (byRank.has(16) && byRank.has(17)) add([52, 53]);

  const addChains = (copies: 1 | 2 | 3, minimum: number) => {
    for (let first = 3; first <= 14; first += 1) {
      for (let length = minimum; first + length - 1 <= 14; length += 1) {
        const bodyRanks = Array.from({ length }, (_, offset) => first + offset);
        if (!bodyRanks.every((rank) => (byRank.get(rank)?.length ?? 0) >= copies)) break;
        const body = bodyRanks.flatMap((rank) => take(rank, copies));
        add(body);
        if (copies !== 3) continue;
        const remaining = hand.filter((id) => !bodyRanks.includes(rankOfCard(id)));
        for (const wings of combinations(remaining, length)) add([...body, ...wings]);
        const pairRanks = ranksWith(2).filter((rank) => !bodyRanks.includes(rank));
        for (const wings of combinations(pairRanks, length)) add([...body, ...wings.flatMap((rank) => take(rank, 2))]);
      }
    }
  };
  addChains(1, 5);
  addChains(2, 3);
  addChains(3, 2);
  return output;
}
