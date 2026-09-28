import { classifyDoudizhuPlay, type DoudizhuPattern } from '../../services/doudizhu/rules';
import { isReachableDoudizhuGame } from '../../services/doudizhu/game';

export type DoudizhuSeat = 0 | 1 | 2;
export type DoudizhuSide = 'landlord' | 'farmers';

export type DoudizhuMove =
  | { type: 'bid'; seat: DoudizhuSeat; points: 0 | 1 | 2 | 3 }
  | { type: 'play'; seat: DoudizhuSeat; cards: number[] }
  | { type: 'pass'; seat: DoudizhuSeat };

export type DoudizhuUiAction =
  | { type: 'invite'; npcIds: [string, string]; seed: number; gameId: string }
  | { type: 'bid'; points: 0 | 1 | 2 | 3 }
  | { type: 'play'; cards: number[] }
  | { type: 'pass' }
  | { type: 'abandon' };

export interface DoudizhuLogEntry {
  seat: DoudizhuSeat;
  type: DoudizhuMove['type'];
  cards?: number[];
  points?: number;
}

export interface DoudizhuGame {
  id: string;
  npcIds: [string, string];
  seed: number;
  redeals: number;
  hands: [number[], number[], number[]];
  bottom: number[];
  played: number[];
  phase: 'bidding' | 'playing' | 'finished';
  bids: [number | null, number | null, number | null];
  highestBid: number;
  landlord: DoudizhuSeat | null;
  activeSeat: DoudizhuSeat;
  trick: { seat: DoudizhuSeat; cards: number[]; pattern: DoudizhuPattern } | null;
  passCount: number;
  publicLog: DoudizhuLogEntry[];
  result: { winningSide: DoudizhuSide; winnerSeat: DoudizhuSeat; spring: boolean } | null;
  settled: boolean;
}

export interface DoudizhuGameSummary {
  id: string;
  npcIds: [string, string];
  winningSide: DoudizhuSide;
  landlord: DoudizhuSeat;
}

export interface DoudizhuState {
  currentGame: DoudizhuGame | null;
  recentGames: DoudizhuGameSummary[];
  settledGameIds: string[];
  lastError?: string;
}

export const createEmptyDoudizhuState = (): DoudizhuState => ({
  currentGame: null,
  recentGames: [],
  settledGameIds: [],
});

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const seat = (value: unknown): value is DoudizhuSeat => value === 0 || value === 1 || value === 2;
const cardList = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((id) => Number.isInteger(id) && id >= 0 && id <= 53);
const unique = (cards: readonly number[]) => new Set(cards).size === cards.length;

export function isValidDoudizhuGame(value: unknown): value is DoudizhuGame {
  const game = record(value);
  if (!game || typeof game.id !== 'string' || !game.id || game.id.length > 128) return false;
  const ids = game.npcIds;
  if (!Array.isArray(ids) || ids.length !== 2 || ids.some((id) => typeof id !== 'string' || !id || id.length > 128) || ids[0] === ids[1]) return false;
  if (!Number.isInteger(game.seed) || !Number.isInteger(game.redeals) || Number(game.redeals) < 0 || Number(game.redeals) > 100000) return false;
  const hands = game.hands;
  if (!Array.isArray(hands) || hands.length !== 3 || hands.some((hand) => !cardList(hand))) return false;
  if (!cardList(game.bottom) || game.bottom.length !== 3 || !unique(game.bottom) || !cardList(game.played)) return false;
  const played = game.played;
  const all = [...hands.flat(), ...played];
  if (!unique(all)) return false;
  if (!Array.isArray(game.bids) || game.bids.length !== 3 || game.bids.some((bid) => bid !== null && ![0, 1, 2, 3].includes(bid))) return false;
  if (![0, 1, 2, 3].includes(game.highestBid as number) || !seat(game.activeSeat) || ![0, 1].includes(game.passCount as number)) return false;
  if (!Array.isArray(game.publicLog) || game.publicLog.length > 180 || game.publicLog.some((value) => {
    const entry = record(value);
    if (!entry || !seat(entry.seat)) return true;
    if (entry.type === 'bid') return ![0, 1, 2, 3].includes(entry.points as number) || entry.cards !== undefined;
    if (entry.type === 'play') return !cardList(entry.cards) || entry.cards.length === 0 || !unique(entry.cards) || entry.points !== undefined;
    if (entry.type === 'pass') return entry.cards !== undefined || entry.points !== undefined;
    return true;
  })) return false;
  if (typeof game.settled !== 'boolean') return false;
  if (game.phase === 'bidding') {
    if (game.landlord !== null || game.result !== null || game.trick !== null || game.settled || game.passCount !== 0 || played.length !== 0) return false;
    if (hands.some((hand) => hand.length !== 17) || all.length + game.bottom.length !== 54 || !unique([...all, ...game.bottom])) return false;
  } else if (game.phase === 'playing' || game.phase === 'finished') {
    if (!seat(game.landlord) || all.length !== 54 || !game.bottom.every((id) => all.includes(id))) return false;
    if (game.trick !== null) {
      const trick = record(game.trick);
      if (!trick || !seat(trick.seat) || !cardList(trick.cards) || !trick.cards.every((id) => played.includes(id))) return false;
      const pattern = classifyDoudizhuPlay(trick.cards);
      if (!pattern || JSON.stringify(pattern) !== JSON.stringify(trick.pattern)) return false;
    } else if (game.passCount !== 0) return false;
    if (game.phase === 'playing' && (game.result !== null || game.settled || hands.some((hand) => hand.length === 0))) return false;
    if (game.phase === 'finished') {
      const result = record(game.result);
      if (!result || !seat(result.winnerSeat) || typeof result.spring !== 'boolean' || hands[result.winnerSeat].length !== 0) return false;
      if (result.winningSide !== (result.winnerSeat === game.landlord ? 'landlord' : 'farmers')) return false;
    }
  } else return false;
  return true;
}

export function normalizeDoudizhuState(raw: unknown): DoudizhuState {
  const input = record(raw);
  if (!input) return createEmptyDoudizhuState();
  const currentGame = input.currentGame == null ? null : isValidDoudizhuGame(input.currentGame) && isReachableDoudizhuGame(input.currentGame) ? input.currentGame : null;
  const recentGames = Array.isArray(input.recentGames) ? input.recentGames.filter((value): value is DoudizhuGameSummary => {
    const summary = record(value);
    return !!summary && typeof summary.id === 'string' && summary.id.length <= 128
      && Array.isArray(summary.npcIds) && summary.npcIds.length === 2
      && summary.npcIds.every((id) => typeof id === 'string' && !!id)
      && (summary.winningSide === 'landlord' || summary.winningSide === 'farmers') && seat(summary.landlord);
  }).slice(-20) : [];
  const settledGameIds = Array.isArray(input.settledGameIds)
    ? [...new Set(input.settledGameIds.filter((id): id is string => typeof id === 'string' && !!id && id.length <= 128))].slice(-50)
    : [];
  return {
    currentGame,
    recentGames,
    settledGameIds,
    ...(input.currentGame != null && !currentGame ? { lastError: '牌局数据损坏，请返回选人并开始新局。' }
      : typeof input.lastError === 'string' && input.lastError ? { lastError: input.lastError.slice(0, 300) } : {}),
  };
}
