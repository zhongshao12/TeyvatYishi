import type { CoreSnapshot } from '../contracts/state';
import type { RecallDependencies } from './recallTypes';
import type { API配置项 } from '@/models/settings';
import type { 提示词模块 } from '@/models/prompts';
import { generateSteambirdArticles } from '@/services/ai/steambirdModel';
import { core2TextCompletion } from '@/services/ai/core2TextCompletion';
import { normalizeConfirmedSteambirdFacts } from '@/models/teyvat/steambird';
import { buildCoreConsumerContext } from './consumerContext';

export async function generateCoreNews(input: { snapshot: CoreSnapshot; config: API配置项; promptModules?: 提示词模块[]; maxEntries?: number; signal?: AbortSignal }, deps: RecallDependencies & { generate?: typeof generateSteambirdArticles }) {
  const context = await buildCoreConsumerContext({ snapshot: input.snapshot, target: 'news', npcIds: [], userInput: '', signal: input.signal }, deps), events = [];
  for (let start = 0; start < context.bundle.selectedLeafIds.length; start += 50) {
    const page = await deps.repo.queryEvents({ scope: input.snapshot.head.scope, cutoffSeq: input.snapshot.head.coreSeq, eventIds: context.bundle.selectedLeafIds.slice(start, start + 50), limit: 50 });
    events.push(...page.items);
  }
  const publicFacts = normalizeConfirmedSteambirdFacts(events.filter(event => event.visibility.kind === 'public' && !event.type.startsWith('communication.') && !event.type.startsWith('player.') && event.type !== 'turn.complete').map(event => ({
    id: event.eventId, settlementId: event.operationId, turn: event.turn, title: event.type,
    detail: event.evidenceRefs.map(ref => ref.quote).join('\n'), evidence: event.evidenceRefs.map(ref => ref.quote).join('\n'), worldMoment: event.occurredMoment,
    channel: 'public_event', confirmation: 'explicit_public_marker',
  })));
  if (!publicFacts.length) return { kind: 'empty' as const, bundle: context.bundle, articles: [] };
  const articles = await (deps.generate ?? generateSteambirdArticles)(input.config, { publicFacts, maxEntries: Math.max(1, Math.min(5, Math.trunc(input.maxEntries ?? 3))), signal: input.signal, promptModules: input.promptModules }, core2TextCompletion);
  const ids = new Set(publicFacts.map(fact => fact.id));
  if (articles.some(article => !article.sourceFactIds.length || article.sourceFactIds.some(id => !ids.has(id)))) throw Error('CORE2_NEWS_UNKNOWN_SOURCE');
  return { kind: 'generated' as const, bundle: context.bundle, articles };
}
