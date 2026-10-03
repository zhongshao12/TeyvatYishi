import type { FactCandidate, StoryBlock } from '@/models/teyvat/narrativeTurn';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import { normalizeConfirmedSteambirdFacts, type ConfirmedSteambirdFact, type SteambirdNews } from '@/models/teyvat/steambird';
import { normalizeWorldMoment } from '@/services/worldMoment';

const nonPublic = /私下|私聊|群聊|悄声|小声|低声|内心|心里|秘密|没有公开|未公开|尚未|并未|从未|假如|如果|假设|计划|打算|准备|将要|可能|据说|传闻/u;
/** Non-security deterministic identity includes the owning settlement, never the player name. */
function identity(text: string): string {
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(text)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return hash.toString(36);
}
export function confirmSteambirdFact(candidate: FactCandidate, input: { history: readonly StoryBlock[]; moment: WorldMoment | null; playerConfirmed: boolean }): ConfirmedSteambirdFact | null {
  const moment = normalizeWorldMoment(input.moment);
  if (input.moment?.worldName !== '提瓦特' || !moment?.date || !moment.clock || !moment.location) return null;
  const evidence = candidate.evidence?.trim();
  if (!evidence) return null;
  const block = input.history.find(item => item.kind === 'narration' && item.text.includes(evidence));
  if (!block) return null;
  const marker = /^(公开公告|公开事件)[：:]\s*/u.exec(block.text.trim());
  if (!input.playerConfirmed && (!marker || nonPublic.test(block.text))) return null;
  // A manual confirmation authorizes a visible occurrence, not an unexecuted thought or plan.
  if (input.playerConfirmed && /内心|心里|计划|打算|假如|假设|将要/u.test(evidence)) return null;
  const detail = evidence.replace(/^(公开公告|公开事件)[：:]\s*/u, '').trim();
  if (!detail) return null;
  const channel = input.playerConfirmed ? 'player_confirmed' : marker?.[1] === '公开公告' ? 'public_announcement' : 'public_event';
  return { id: `public_${identity(`${moment.settlementId}\n${evidence}`)}`, settlementId: moment.settlementId, turn: moment.turn, title: Array.from(detail).slice(0, 40).join(''), detail, worldMoment: moment, channel, evidence, confirmation: input.playerConfirmed ? 'player' : 'explicit_public_marker' };
}
export function selectUnreportedPublicFacts(news: SteambirdNews, range: { firstTurn: number; lastTurn: number }): ConfirmedSteambirdFact[] {
  const reported = new Set(news.articles.flatMap(article => article.sourceFactIds ?? []));
  return normalizeConfirmedSteambirdFacts(news.confirmedFacts).filter(fact => fact.turn >= range.firstTurn && fact.turn <= range.lastTurn && !reported.has(fact.id));
}
