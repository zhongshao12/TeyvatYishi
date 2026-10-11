import { applyLegacyGameStateOverrides, toLegacyMemory, toLegacyStoryWeaving, toLegacyTurnCheckpoint, type UseGameStateReturn } from '@/hooks/useGameState';
import type { TeyvatGameState } from '@/models/teyvat/state';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import { 创建默认记忆系统设置, type API配置项 } from '@/models/settings';
import { applyStoryArchiveCodexRuntimeUnlock } from '@/services/codexRuntimeUnlock';
import { resolveCourierApiConfig } from '@/services/ai/courierLetterModel';
import { planProactiveContacts } from '@/services/proactiveContacts';
import { preparePostSettlementNpcState, applyStoryProgressNpcMemory } from './postSettlementCommitStage';
import { settlePostNarrativeMemory } from './postNarrativeMemoryStage';
import { runCourierDeliveryTask, runCourierReplyTask } from './courierBackgroundJobs';
import { hasSettlementTailTask, markSettlementTailTask } from './postSettlementTaskState';

function legacyNpcs(game: TeyvatGameState) {
  return toLegacyTurnCheckpoint({ npc: game.NPC, turnCount: game.turnCount, pendingOpeningTrigger: null }).NPC as UseGameStateReturn['NPC'];
}
/** Reuses domain task bodies; does not re-run variable settlement or model narrative generation. */
export async function recoverSettlementDomainTasks(input: {
  game: TeyvatGameState; state: UseGameStateReturn; settlementId: string; moment?: WorldMoment;
  userInput: string; body: string; summary: string; sessionId: number;
}): Promise<TeyvatGameState> {
  let game = input.game;
  const settings = input.state.gameSettings;
  const memorySettings = settings.记忆系统 ?? 创建默认记忆系统设置();
  const main = input.state.apiSettings.configs.find(config => config.id === input.state.apiSettings.activeConfigId)
    ?? input.state.apiSettings.configs[0] ?? null;
  const assertCurrent = () => { if (input.state.getGameSessionId() !== input.sessionId) throw new DOMException('存档已切换', 'AbortError'); };
  assertCurrent();
  if (!hasSettlementTailTask(game, input.settlementId, 'memory')) {
    const noApi: API配置项 = { id: 'recovery-local', name: '恢复本地记忆', provider: 'openai_compatible', baseUrl: '', apiKey: '', model: '', createdAt: 0, updatedAt: 0 };
    const result = await settlePostNarrativeMemory({ memory: toLegacyMemory(game), irminsul: game.世界树,
      userInput: input.userInput, body: input.body, narrativeSummary: input.summary, turn: game.turnCount,
      moment: input.moment, settings: memorySettings, mainConfig: main ?? noApi });
    assertCurrent();
    game = markSettlementTailTask({ ...applyLegacyGameStateOverrides(game, { 记忆: result.memory }), 世界树: result.irminsul }, input.settlementId, 'memory');
  }
  if (!hasSettlementTailTask(game, input.settlementId, 'npcStory')) {
    const prepared = preparePostSettlementNpcState({ source: legacyNpcs(game), nsfwEnabled: settings.enableNsfw,
      maleNsfwArchiveEnabled: settings.enableMaleNsfwArchive, compressionThreshold: memorySettings.NPC记忆压缩阈值,
      compressionPrompt: memorySettings.NPC记忆压缩提示词, turn: game.turnCount });
    const story = toLegacyStoryWeaving(game.叙事.storyWeaving);
    const npcs = applyStoryProgressNpcMemory(prepared.records, story, game.turnCount, input.moment);
    const codex = applyStoryArchiveCodexRuntimeUnlock({ codex: game.图鉴, storyWeaving: story }).codex;
    game = markSettlementTailTask({ ...applyLegacyGameStateOverrides(game, { NPC: npcs }), 图鉴: codex }, input.settlementId, 'npcStory');
  }
  return game;
}

export async function recoverSettlementCourierTasks(input: {
  game: TeyvatGameState; state: UseGameStateReturn; settlementId: string; moment?: WorldMoment;
  userInput: string; body: string; sessionId: number; now: number;
}): Promise<{ game: TeyvatGameState; npcStart: UseGameStateReturn['NPC']; npcResult: UseGameStateReturn['NPC'] }> {
  let game = input.game;
  const npcs = legacyNpcs(game);
  if (hasSettlementTailTask(game, input.settlementId, 'phone') || !input.state.gameSettings.手机系统.enabled) {
    return { game, npcStart: npcs, npcResult: npcs };
  }
  const settings = input.state.gameSettings.手机系统;
  const main = input.state.apiSettings.configs.find(config => config.id === input.state.apiSettings.activeConfigId) ?? input.state.apiSettings.configs[0] ?? null;
  const letterApiConfig = resolveCourierApiConfig(settings.api, main);
  const environment = { location: game.世界.当前地点, timeText: game.世界.当前时间 };
  const proactive = planProactiveContacts({ courier: game.手机, npcs, turn: game.turnCount, travelDay: game.世界.旅程天数 });
  const delivery = await runCourierDeliveryTask({ enabled: true, autoGenerateSeeds: settings.autoGenerateSeeds,
    courier: game.手机, npcs, turn: game.turnCount, now: input.now, worldMoment: input.moment,
    userInput: input.userInput, body: input.body, maxSeedsPerTurn: settings.maxSeedsPerTurn,
    contactCooldownTurns: settings.contactCooldownTurns, allowStoryCreatedGroups: settings.allowStoryCreatedGroups,
    environment, travelerName: game.旅行者.姓名, letterApiConfig, proactiveSeeds: proactive.seeds });
  if (input.state.getGameSessionId() !== input.sessionId) throw new DOMException('存档已切换', 'AbortError');
  const reply = await runCourierReplyTask({ enabled: true, courier: delivery.courier, npcs: delivery.npcs,
    turn: game.turnCount, worldMoment: input.moment, sessionId: input.sessionId, environment,
    travelerName: game.旅行者.姓名, letterApiConfig });
  if (input.state.getGameSessionId() !== input.sessionId) throw new DOMException('存档已切换', 'AbortError');
  game = applyLegacyGameStateOverrides(game, { NPC: reply.npcs, 手机: reply.courier });
  // Keep the task's legacy memory deltas until commit: the formal projection does
  // not retain 好感变动, which is needed when live affinity was edited concurrently.
  return { game: markSettlementTailTask(game, input.settlementId, 'phone'), npcStart: npcs, npcResult: reply.npcs };
}
