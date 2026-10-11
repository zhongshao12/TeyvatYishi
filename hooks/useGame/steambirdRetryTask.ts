import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { SteambirdNews } from '@/models/teyvat/steambird';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import { resolveSteambirdApiConfig } from '@/services/ai/steambirdModel';
import { selectUnreportedPublicFacts } from '@/services/steambirdPublicFacts';
import { executeSteambirdTaskForSession } from './postTurnSteambirdTask';

/** Recovery and manual retry consume the same frozen public-evidence contract as the normal turn. */
export async function recoverSteambirdTask(input: {
  state: UseGameStateReturn; current: SteambirdNews; moment?: WorldMoment;
  turn: number; sessionId: number; taskId?: string;
}) {
  let news = input.current;
  const settings = input.state.gameSettings.蒸汽鸟报系统;
  const frozen = news.generationTasks?.find(task => task.id === input.taskId && task.status !== 'success');
  const moment = frozen?.worldMoment ?? input.moment;
  if (!moment) return { news, status: 'skipped' as const, reason: '缺少该回合的已提交世界时刻，未投递正文。' };
  const interval = Math.max(5, Math.min(10, Math.trunc(settings?.generateIntervalTurns ?? 5) || 5));
  const main = input.state.apiSettings.configs.find(config => config.id === input.state.apiSettings.activeConfigId)
    ?? input.state.apiSettings.configs[0] ?? null;
  const result = await executeSteambirdTaskForSession({
    sessionId: input.sessionId, settlementId: frozen?.settlementId ?? moment.settlementId,
    turn: frozen?.turn ?? input.turn, worldMoment: moment,
    facts: frozen?.facts ?? selectUnreportedPublicFacts(news, { firstTurn: Math.max(0, input.turn - interval + 1), lastTurn: input.turn }),
    config: resolveSteambirdApiConfig(settings?.api, main), promptModules: input.state.gameSettings.promptModules,
    maxEntries: settings?.maxNewEntriesPerTurn ?? 3,
  }, { read: () => news, update: update => { news = update(news); }, isCurrent: () => input.state.getGameSessionId() === input.sessionId });
  return { news, status: result.status, reason: result.reason };
}
