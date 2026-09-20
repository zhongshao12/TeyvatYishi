import {
  applyLegacyGameStateOverrides,
  toLegacyTurnCheckpoint,
  type UseGameStateReturn,
} from '@/hooks/useGameState';
import { 创建聊天消息, type 聊天消息, type 回合快照 } from '@/models/chat';
import { createEmptyNarrativeTurn, narrativeTurnBodyText, type NarrativeTurn } from '@/models/teyvat/narrativeTurn';
import type { SteambirdNews } from '@/models/teyvat/steambird';
import { getNarrativeTurnNormalizationWarnings, revalidateFactCandidatesForBody } from '@/services/ai/narrativeTurnParser';
import { appendApiErrorReport } from '@/services/ai/apiErrorReportService';
import { isNonRetryableAIError } from '@/services/ai/deepSeekRecovery';
import { resolveMainNarrativeMaxAttempts } from '@/services/ai/mainNarrativeRetryPolicy';
import { buildOpeningSystemPrompt, buildSystemPrompt } from './systemPromptBuilder';
import { buildTavernMessageChain } from './tavernMessageChainBuilder';
import { applyTavernOutputRegexScripts } from './tavernRegexProcessor';
import { getCurrentSTPresetV2 } from '@/utils/stSettingsNormalizer';
import { getBuiltinPresetsV2, loadAllBuiltinTavernPresets } from '@/data/builtinPresets';
import { 构建天气Prompt片段 } from '@/data/weatherRules';
import {
  addImmediateMemory,
} from './memoryUtils';
import { runSteambirdGenerationStep } from './steambirdWorkflow';
import { applyAbortedWorkflowPolicy, runCommittedSettlementRecovery, runPendingSettlementRecovery, type WorkflowResumeResult } from './recoveryResume';
import {
  archiveCommittedQuestSettlement,
  collectQuestUpdatePayloads,
  notifyCommittedQuestUpdate,
} from './questWorkflow';
import { evaluateStoryWeavingGate, getStoryWeavingInjectionDiagnostics } from '@/services/storyWeaving';
import { 格式化开局档案上下文 } from '@/models/world';
import { loadSetting, saveGame, saveSetting, saveSettings } from '@/services/dbService';
import {
  clearWorkflowRecoveryJournal,
  createWorkflowRecoveryJournal,
  persistWorkflowRecoveryJournal,
  updateWorkflowRecoveryJournal,
  type WorkflowRecoveryJournal,
} from '@/services/workflowRecovery';
import { buildSavePayload, commitActiveSaveTreeMeta } from './saveLoadWorkflow';
import type { TeyvatGameState } from '@/models/teyvat/state';
import {
  createDocumentVisibilitySource,
  createVisibilityBufferedPublisher,
  type VisibilityBufferedPublisher,
} from '@/utils/visibilityBufferedPublisher';
import { createRafCoalescedSetter } from '@/utils/rafCoalescedSetter';
import { setStreamingMessage } from '@/utils/streamingMessageStore';
import { createStreamingPreviewDelayController } from '@/utils/streamingPreviewDelay';
import type { 变量命令, 变量命令批次 } from '@/models/variableCommand';
import { enterElementalEcho } from '@/services/elementalAttunementService';
import { resolveCourierApiConfig } from '@/services/ai/courierLetterModel';
import { mergeCourierSystemUpdates } from '@/services/ai/courierService';
import { runCourierDeliveryTask, runCourierReplyTask } from './courierBackgroundJobs';
import { 天气列表 } from '@/data/weatherRules';
import type { ElementId } from '@/models/teyvat/elements';
import { ELEMENT_NAMES } from '@/styles/elementTokens';
import { 创建默认记忆系统设置 } from '@/models/settings';
import type { API配置项 } from '@/models/settings';
import type { 队列任务记录 } from '@/models/queueTask';
import { applyStoryArchiveCodexRuntimeUnlock } from '@/services/codexRuntimeUnlock';
import { buildPersistedStoryWeavingSystem } from '@/data/storyWeavingPreset';
import { getBuiltinPresets } from '@/data/builtinPresets';
import { 创建默认图鉴系统设置 } from '@/models/settings';
import { selectNpcLedgersForTurn, type NPC记录 } from '@/models/npc';
import {
  buildImmediateStoryReview,
  buildCodexKeywordRecallQuery,
  buildMainRecallQuery,
  getMainHistoryWindow,
} from './historyWindow';
import { restorePreTurnSnapshot } from './turnSnapshot';
import { getNsfwArchiveBlockReason } from '@/utils/nsfwArchivePolicy';
import { normalizePlayerSpeechInBody } from '@/utils/playerSpeechGuard';
import { sanitizeParsedResponse, sanitizeContaminatedText } from '@/utils/textSanitizer';
import { getAnticipatedNpcNamesForTurn, getCodexNpcNamesForTurn, getMissingPartyMembers } from './npcPresence';
import { buildCachePrefixDiagnostics, buildTurnTokenUsage } from './turnDiagnostics';
import { applyNarrativeWorldStage } from './narrativeWorldStage';
import { buildNarrativeApiMessages, injectPromptModuleMessages } from './promptModuleMessageInjection';
import {
  buildRerollGenerationGuard,
  DEEPSEEK_MAIN_FORMAT_GUARD,
  requestMainNarrativeAttempt,
  runValidatedMainNarrativeRequest,
} from './mainNarrativeRequestStage';
import { runPostTurnBackgroundTasks, runSteambirdPostTurnTask } from './postTurnBackgroundTasks';
import { createMainNarrativeStreamingSession, splitStreamingReveal } from './mainNarrativeStreamingSession';
import { runPostTurnIrminsulArchiveTask } from './postTurnIrminsulTask';
import { runPostTurnNarrativeImageTask } from './postTurnNarrativeImageTask';
import { runPostTurnAutosaveTask } from './postTurnAutosaveTask';
import {
  attachNpcLedgerUpdateDebug,
  buildNpcLedgerDebug,
  formatCodexDiagnosticsPreview,
  formatNpcLedgerPreview,
} from './turnDebugContext';
import type { CodexEntry } from '@/models/teyvat/codex';
import { globalImageTaskQueue } from '@/utils/imageTaskQueue';
import { DEFAULT_NOTIFICATION_SETTINGS, notifyEvent } from '@/utils/notifications';
import { pushToast } from '@/utils/toastStore';
import { compactPreTurnSnapshot } from '@/utils/saveRuntimeCompactor';
import { compactChatHistoryForLongSession, compactVariableBatchHistory } from '@/utils/longSessionRetention';
import { buildElementalFieldPromptSection } from '@/models/teyvat';
import { createMacroContext, type MacroContext, type MacroGameState } from '@/utils/macroEngine';
import { updateTriggerStatesAfterTurn } from '@/utils/worldbook';
import { pushWorkflowQueueTask as pushQueueTask } from './workflowQueue';
import type {
  VariableSettlementParams,
  VariableSettlementResult,
} from './variableSettlementWorkflow';
import { buildMainRecallStage } from './mainRecallStage';
import { buildOpeningSteambirdPreprocess } from './openingSteambirdStage';
import { settlePostTurnElements } from './postTurnElementalStage';
import { settlePostNarrativeMemory } from './postNarrativeMemoryStage';

function stripLeakedHistoryMetaFromBody(body: string): string {
  if (!body) return body;
  return body
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim();
      if (!line) return raw;
      const historyTag = line.match(/^【\s*(历史时间|历史正文|历史狭间问答|历史狭间评判|历史短期记忆|历史变量草稿|历史剧情规划)\s*】\s*(.*)$/);
      if (!historyTag) return raw;
      const tag = historyTag[1] ?? '';
      const rest = historyTag[2] ?? '';
      if (tag === '历史时间') return '';
      return rest.trim() ? `【旁白】${rest.trim()}` : '';
    })
    .filter((line) => line.trim())
    .join('\n');
}

// 区E执法块(结构轮, 2026-07-26): 注入在聊天历史与玩家输入之后——离生成点最近的位置。
// 实现参照狭间评判提醒的既有先例(尾部 user 消息,三 provider 通用,连续 user 消息已有
// DeepSeek 守卫先例)。素材复用本回合已算好的图鉴命中,不新增检索。
function buildTurnEnforcementBlock(input: {
  playerName: string;
  wordCountTarget: number;
  codexEntries?: CodexEntry[];
  storyWeavingActive: boolean;
}): string {
  const lines: string[] = ['# 本回合生成前核对（最高优先级，覆盖上文所有软性描述）'];
  const characters = (input.codexEntries ?? []).filter((entry) => (
    entry.category === 'character' && entry.injection.type === 'character'
  ));
  if (characters.length) {
    lines.push('【在场角色锚点】');
    for (const c of characters) {
      if (c.injection.type !== 'character') continue;
      const speech = c.injection.speechStyle?.trim() ?? '';
      const forbid = c.injection.portrayalBoundaries?.trim() ?? '';
      const bits = [
        speech ? `说话方式：${speech.length > 60 ? `${speech.slice(0, 58)}…` : speech}` : '',
        forbid ? `禁止误写：${forbid.length > 60 ? `${forbid.slice(0, 58)}…` : forbid}` : '',
      ].filter(Boolean).join('｜');
      if (bits) lines.push(`- ${c.name}：${bits}`);
    }
  }
  lines.push('【硬性要点】');
  lines.push(`- 发言归属：【${input.playerName}】只承载玩家本回合明确说出的原话；NPC 台词、拟声词、环境音绝不挂玩家名。`);
  lines.push('- 禁止代写玩家的心理、神态、感受或决定；正文内禁止任何选项菜单结构。');
  if (input.storyWeavingActive) {
    lines.push('- 剧情编织滑窗只按门禁推进；已发生的事件禁止重演，未开始的分段禁止抢跑。');
  }
  lines.push(`- body 可见文本不少于 ${input.wordCountTarget} 字；NarrativeTurn 四个根字段齐全。`);
  lines.push('逐项核对以上约束后再动笔；与上文任何描述冲突时，以本块为准。');
  return lines.join('\n');
}

/** 格式伪历史：在 `user:开始任务` 后注入最小合法 NarrativeTurn。 */
const NARRATIVE_TURN_EXAMPLE_USER = '开始任务';
const NARRATIVE_TURN_EXAMPLE_ASSISTANT = JSON.stringify({
  body: [{ kind: 'system', id: 'ready', text: '系统已就绪，等待玩家发起首回合。' }],
  choices: [],
  factCandidates: [],
  continuation: { summary: '系统初始化完成。', unresolved: [] },
});

function isDeepSeekMainConfig(config: { provider?: string; baseUrl?: string; model?: string }): boolean {
  const provider = String(config.provider ?? '').toLowerCase();
  const baseUrl = String(config.baseUrl ?? '').toLowerCase();
  const model = String(config.model ?? '').toLowerCase();
  return provider === 'deepseek' || baseUrl.includes('deepseek') || model.includes('deepseek');
}

function applyNsfwVariablePolicy(
  commands: 变量命令[],
  policy: { nsfwEnabled: boolean; maleNsfwArchiveEnabled: boolean },
  npcs: NPC记录[] = [],
): {
  allowedCommands: 变量命令[];
  rejectedCommands: Array<{ command: 变量命令; ok: false; reason: string }>;
} {
  const allowedCommands: 变量命令[] = [];
  const rejectedCommands: Array<{ command: 变量命令; ok: false; reason: string }> = [];

  for (const command of commands) {
    const key = command.key ?? '';
    const valueText = JSON.stringify(command.value ?? '');
    const touchesNsfw = key.includes('NSFW档案') || valueText.includes('NSFW档案');
    const touchesMaleArchive =
      key.includes('男性身体档案') ||
      key.includes('男性器') ||
      valueText.includes('男性身体档案') ||
      valueText.includes('男性器');

    if (touchesNsfw && !policy.nsfwEnabled) {
      rejectedCommands.push({
        command,
        ok: false,
        reason: 'NSFW 总开关未开启，已阻止写入 NSFW 档案。',
      });
      continue;
    }

    if (touchesNsfw) {
      const blockedReason = getNsfwBlockedCommandReason(command, npcs);
      if (blockedReason) {
        rejectedCommands.push({
          command,
          ok: false,
          reason: blockedReason,
        });
        continue;
      }
    }

    if (touchesMaleArchive && !policy.maleNsfwArchiveEnabled) {
      rejectedCommands.push({
        command,
        ok: false,
        reason: '男性 NSFW 档案开关未开启，已阻止写入男性身体档案。',
      });
      continue;
    }

    allowedCommands.push(command);
  }

  return { allowedCommands, rejectedCommands };
}

function getNsfwBlockedCommandReason(command: 变量命令, npcs: NPC记录[]): string | null {
  const text = `${command.key}\n${JSON.stringify(command.value ?? '')}`;
  const selector = command.key.match(/^NPC\[([^\]]+)\]/)?.[1] ?? '';
  const selectorValue = selector.includes('=')
    ? selector.split('=').slice(1).join('=').replace(/^["']|["']$/g, '').trim()
    : selector.trim();
  const npc = npcs.find((item) =>
    item.id === selectorValue ||
    item.姓名 === selectorValue ||
    item.别名 === selectorValue ||
    text.includes(item.姓名) ||
    Boolean(item.别名 && text.includes(item.别名)),
  );
  const reason = getNsfwArchiveBlockReason(npc, selectorValue, text);
  return reason ? `NSFW 档案已阻止：${reason}。` : null;
}

function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

function buildRecentTurnWindowForSteambird(history: 聊天消息[], currentUserInput: string, currentBody: string, interval: number): string[] {
  const windowSize = Math.max(5, Math.min(10, Math.trunc(interval) || 5));
  const pairs: string[] = [];
  let pendingUser = '';

  for (const msg of history) {
    if (msg.role === 'user') {
      pendingUser = msg.content;
      continue;
    }
    if (msg.role === 'assistant') {
      const body = msg.parsedResponse ? narrativeTurnBodyText(msg.parsedResponse) : msg.content;
      if (pendingUser || body) {
        pairs.push(`- 玩家：${pendingUser || '（无）'}\n  正文：${body.slice(0, 420)}`);
      }
      pendingUser = '';
    }
  }

  pairs.push(`- 玩家：${currentUserInput || '（无）'}\n  正文：${currentBody.slice(0, 420)}`);
  return pairs.slice(-windowSize);
}

async function revealStreamingPreview(
  state: UseGameStateReturn,
  text: string,
  signal?: AbortSignal,
  options?: { delayMs?: number; minChunks?: number },
): Promise<void> {
  const chunks = splitStreamingReveal(text);
  if (!chunks.length) return;
  const streamSetter = createRafCoalescedSetter(setStreamingMessage);
  const delayController = createStreamingPreviewDelayController(signal);
  if (signal?.aborted) {
    delayController.dispose();
    return;
  }
  if (delayController.interrupted) {
    streamSetter.flush(text.trim());
    delayController.dispose();
    return;
  }
  const minChunks = options?.minChunks ?? 8;
  const delayMs = options?.delayMs ?? 18;
  const revealChunks =
    chunks.length >= minChunks
      ? chunks
      : (() => {
          const chars = Array.from(text.trim());
          const chunkSize = Math.max(3, Math.ceil(chars.length / minChunks));
          const expanded: string[] = [];
          for (let i = 0; i < chars.length; i += chunkSize) {
            expanded.push(chars.slice(i, i + chunkSize).join(''));
          }
          return expanded;
        })();

  let preview = '';
  try {
    for (const chunk of revealChunks) {
      if (signal?.aborted) return;
      preview += chunk;
      streamSetter.set(preview);
      await delayController.wait(delayMs);
      if (signal?.aborted) return;
      if (delayController.interrupted) {
        streamSetter.flush(text.trim());
        return;
      }
    }
    // Ensure the final preview is committed before callers clear/replace it.
    streamSetter.flush(preview);
  } finally {
    delayController.dispose();
    streamSetter.cancel();
  }
}

export interface SendWorkflowDeps {
  state: UseGameStateReturn;
  getActiveConfig: () => import('@/models/settings').API配置项 | null;
  onBeforeSend: () => void;
  onAfterSend: () => void;
  rerollContext?: {
    nonce: string;
    previousResponse: string;
  } | null;
}


export function compactForRerollInstruction(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > 900 ? `${cleaned.slice(0, 900)}...` : cleaned;
}

export async function regenerateNarrativeImagesForMessage(
  state: UseGameStateReturn,
  getActiveConfig: () => API配置项 | null,
  messageId: string,
): Promise<void> {
  const workflow = await import('./narrativeImageWorkflow');
  await workflow.regenerateNarrativeImagesForMessage(state, getActiveConfig, messageId);
}

export async function resumePostSettlementWorkflow(
  state: UseGameStateReturn,
  journal: WorkflowRecoveryJournal,
  committedOverride?: TeyvatGameState,
): Promise<WorkflowResumeResult> {
  try {
    const recovery = await import('./postSettlementRecoveryWorkflow');
    await recovery.runPostSettlementRecoveryWorkflow(state, journal, committedOverride);
    return { ok: true, journal };
  } catch (error) {
    return { ok: false, journal, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function resumeCommittedSettlementWorkflow(
  state: UseGameStateReturn,
  journal: WorkflowRecoveryJournal,
): Promise<WorkflowResumeResult> {
  return runCommittedSettlementRecovery({
    journal,
    currentState: state.game,
    persist: persistWorkflowRecoveryJournal,
    runPostSettlement: async (committed, committedJournal) => {
      const result = await resumePostSettlementWorkflow(state, committedJournal, committed);
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
  });
}

/** Resume a durable pending settlement directly from its normalized frozen source. */
export async function resumePendingSettlementWorkflow(
  state: UseGameStateReturn,
  journal: WorkflowRecoveryJournal,
): Promise<WorkflowResumeResult> {
  return runPendingSettlementRecovery({
    journal,
    currentState: state.game,
    persist: persistWorkflowRecoveryJournal,
    settle: async (source, settlementId) => {
      if (!journal.pendingNarrative || !journal.pendingSettlement) return null;
      const pending = journal.pendingSettlement;
    const config = state.apiSettings.configs.find((item) => item.id === state.apiSettings.activeConfigId)
      ?? state.apiSettings.configs[0]
      ?? null;
      if (!config) return null;
    const legacy = toLegacyTurnCheckpoint({
      turnCount: source.turnCount,
      pendingOpeningTrigger: null,
      traveler: source.旅行者, world: source.世界, npc: source.NPC, inventory: source.背包,
      memory: source.记忆, courier: source.手机, irminsul: source.世界树, codex: source.图鉴,
      steambird: source.蒸汽鸟报, album: source.相册, quest: source.任务, queue: source.后台队列,
      narrative: source.叙事,
    });
    const body = narrativeTurnBodyText(journal.pendingNarrative);
    const settlement = await runVariableCalibrationStep({
      state,
      mainApiConfig: config,
      userInput: journal.input,
      body,
      variableDraft: pending.variableDraft,
      turnAfter: source.turnCount,
      memorySystemSnapshot: legacy.记忆 as import('@/models/memory').记忆系统,
      travelerSnapshot: legacy.旅人 as import('@/models/character').角色数据结构,
      worldSnapshot: legacy.世界 as import('@/models/world').世界状态,
      baseGameSnapshot: source,
      factCandidates: journal.pendingNarrative.factCandidates,
      questUpdates: journal.pendingNarrative.factCandidates.filter((candidate) => candidate.domain === 'quest').map((candidate) => candidate.fact),
      questEnabled: state.gameSettings.任务系统?.enabled === true,
      settlementId,
    });
      return settlement?.committedGame ?? null;
    },
    runPostSettlement: async (committed, committedJournal) => {
      const post = await resumePostSettlementWorkflow(state, committedJournal, committed);
      return post.ok ? { ok: true } : { ok: false, error: post.error };
    },
  });
}

export async function retryQueueTask(
  state: UseGameStateReturn,
  getActiveConfig: () => API配置项 | null,
  task: 队列任务记录,
  mode: 'retry' | 'reroll' = 'retry',
): Promise<void> {
  if (task.id === 'narrative_image_parse' || task.id === 'narrative_image_generate') {
    const targetMessageId = task.targetMessageId ?? findLatestAssistantMessage(state.chatHistory)?.id;
    if (!targetMessageId) {
      pushQueueTask(state, task.id, 'failed', {
        detail: '未找到可重试的正文回合。',
        failCount: (task.failCount ?? 0) + 1,
      });
      return;
    }
    pushQueueTask(state, task.id, 'pending', {
      detail: mode === 'reroll' ? '正在重新解析并生成故事快照。' : '正在重试故事快照任务。',
      turn: task.turn || state.turnCount,
      targetMessageId,
      retrying: true,
      failCount: task.failCount,
    });
    await regenerateNarrativeImagesForMessage(state, getActiveConfig, targetMessageId);
    return;
  }

  if (task.id === 'steambird') {
    await retrySteambirdQueueTask(state, task, mode);
    return;
  }

  if (task.id === 'variable') {
    await retryVariableQueueTask(state, getActiveConfig, task, mode);
  }
}

async function retrySteambirdQueueTask(
  state: UseGameStateReturn,
  task: 队列任务记录,
  mode: 'retry' | 'reroll',
): Promise<void> {
  const assistant = findLatestAssistantMessage(state.chatHistory);
  if (!assistant) {
    pushQueueTask(state, 'steambird', 'failed', {
      detail: '未找到可用于蒸汽鸟报重试的正文回合。',
      failCount: (task.failCount ?? 0) + 1,
    });
    return;
  }
  const userInput = findPreviousUserInput(state.chatHistory, assistant.id);
  const body = assistant.parsedResponse ? narrativeTurnBodyText(assistant.parsedResponse) : assistant.content.trim();
  if (!body) {
    pushQueueTask(state, 'steambird', 'failed', {
      detail: '当前正文为空，无法重试蒸汽鸟报生成。',
      failCount: (task.failCount ?? 0) + 1,
    });
    return;
  }
  const steambirdSettings = state.gameSettings.蒸汽鸟报系统;
  const interval = Math.max(5, Math.min(10, Math.trunc(steambirdSettings?.generateIntervalTurns ?? 5) || 5));
  const abortController = new AbortController();
  pushQueueTask(state, 'steambird', 'pending', {
    detail: mode === 'reroll' ? '正在重生成蒸汽鸟报，本次不受回合间隔限制。' : '正在重试蒸汽鸟报，本次不受回合间隔限制。',
    turn: Number(assistant.gameTime) || task.turn || state.turnCount,
    retrying: true,
    failCount: task.failCount,
    targetMessageId: assistant.id,
  });
  try {
    const result = runSteambirdGenerationStep({
      current: state.蒸汽鸟报,
      publicFacts: [{ title: `第 ${state.turnCount} 回公开见闻`, detail: `${userInput}\n${body}`.trim() }],
      turnCount: state.turnCount,
    });
    if (result?.changed) state.set蒸汽鸟报(result.steambird);
    pushQueueTask(state, 'steambird', result ? 'success' : 'failed', {
      detail: result
        ? result.changed
          ? `蒸汽鸟报已${mode === 'reroll' ? '重生成' : '重试更新'}，当前共 ${result.steambird.articles.length} 篇报道。`
          : '蒸汽鸟报已重试，但模型没有返回可写入的新变化。'
        : '蒸汽鸟报重试失败，请检查蒸汽鸟报 API 配置或模型返回。',
      turn: Number(assistant.gameTime) || task.turn || state.turnCount,
      failCount: result ? task.failCount : (task.failCount ?? 0) + 1,
      targetMessageId: assistant.id,
    });
  } catch (err) {
    pushQueueTask(state, 'steambird', 'failed', {
      detail: `蒸汽鸟报重试失败：${(err as Error).message}`,
      turn: Number(assistant.gameTime) || task.turn || state.turnCount,
      failCount: (task.failCount ?? 0) + 1,
      targetMessageId: assistant.id,
    });
  }
}

async function retryVariableQueueTask(
  state: UseGameStateReturn,
  getActiveConfig: () => API配置项 | null,
  task: 队列任务记录,
  mode: 'retry' | 'reroll',
): Promise<void> {
  const batch = findRetryableVariableBatch(state.variableBatches, task.targetBatchId);
  if (!batch) {
    pushQueueTask(state, 'variable', 'failed', {
      detail: '未找到可安全重试的失败变量批次。若上一批已有成功命令，为避免重复结算，请不要直接重跑整批。',
      failCount: (task.failCount ?? 0) + 1,
    });
    return;
  }
  const assistant = findAssistantMessageForTurn(state.chatHistory, batch.turn) ?? findLatestAssistantMessage(state.chatHistory);
  const mainConfig = getActiveConfig();
  if (!assistant || !mainConfig) {
    pushQueueTask(state, 'variable', 'failed', {
      detail: !assistant ? '未找到变量批次对应的正文回合。' : '未配置主 API，无法重试变量结算。',
      targetBatchId: batch.id,
      failCount: (task.failCount ?? 0) + 1,
    });
    return;
  }
  const body = assistant.parsedResponse ? narrativeTurnBodyText(assistant.parsedResponse) : assistant.content.trim();
  if (!body) {
    pushQueueTask(state, 'variable', 'failed', {
      detail: '当前正文为空，无法重试变量结算。',
      targetBatchId: batch.id,
      failCount: (task.failCount ?? 0) + 1,
    });
    return;
  }
  pushQueueTask(state, 'variable', 'pending', {
    detail: mode === 'reroll' ? '正在重生成变量结算结果。' : '正在重试变量结算。',
    turn: batch.turn,
    targetMessageId: assistant.id,
    targetBatchId: batch.id,
    retrying: true,
    failCount: task.failCount,
  });
  const overrides = await runVariableCalibrationStep({
    state,
    mainApiConfig: mainConfig,
    userInput: findPreviousUserInput(state.chatHistory, assistant.id),
    body,
    variableDraft: assistant.parsedResponse?.factCandidates.length
      ? JSON.stringify({ facts: assistant.parsedResponse.factCandidates })
      : undefined,
    turnAfter: batch.turn + 1,
    memorySystemSnapshot: state.记忆,
    travelerSnapshot: state.旅人,
    worldSnapshot: state.世界,
    allowIrminsul: false,
  });
  const retryBatch = overrides?.batch;
  const hasFailure = retryBatch?.results.some((result) => !result.ok);
  pushQueueTask(state, 'variable', retryBatch && !hasFailure ? 'success' : retryBatch ? 'failed' : 'failed', {
    detail: retryBatch
      ? hasFailure
        ? '变量结算已重试，但仍存在失败命令，请展开查看原始信息。'
        : '变量结算已重试并落地。'
      : '变量结算重试未返回结果。',
    turn: batch.turn,
    targetMessageId: assistant.id,
    targetBatchId: retryBatch?.id ?? batch.id,
    failCount: hasFailure || !retryBatch ? (task.failCount ?? 0) + 1 : task.failCount,
  });
}

function findLatestAssistantMessage(history: 聊天消息[]): 聊天消息 | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (!item) continue;
    if (item.role === 'assistant') return item;
  }
  return undefined;
}

function findAssistantMessageForTurn(history: 聊天消息[], turn: number): 聊天消息 | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (!item) continue;
    if (item.role === 'assistant' && Number(item.gameTime) === turn) return item;
  }
  return undefined;
}

function findPreviousUserInput(history: 聊天消息[], assistantId: string): string {
  const assistantIndex = history.findIndex((item) => item.id === assistantId);
  if (assistantIndex < 0) return '';
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (!item) continue;
    if (item.role === 'user') return item.content;
  }
  return '';
}

function findRetryableVariableBatch(batches: 变量命令批次[], targetBatchId?: string): 变量命令批次 | undefined {
  const candidates = targetBatchId
    ? batches.filter((batch) => batch.id === targetBatchId)
    : [...batches].reverse();
  // 只允许整批完全失败的结果手动重试。
  // 若同一批里已有成功命令，重跑整批可能让已成功的 set/push 再落地一次，造成重复结算。
  return candidates.find((batch) =>
    batch.results.length > 0 &&
    batch.results.every((result) => !result.ok),
  );
}

export async function executeSendWorkflow(
  userInput: string,
  deps: SendWorkflowDeps,
): Promise<void> {
  const { state } = deps;
  const rawConfig = deps.getActiveConfig();
  if (!rawConfig) {
    alert('请先在设置中配置API');
    return;
  }
  const config = rawConfig;
  const mainStoryConfig = config;
  const isOpeningSystemTrigger = state.turnCount === 1 && userInput.startsWith('[系统]');
  const openingInstruction =
    '请根据当前角色、当前场景、世界书与内置提示词，直接生成第 0 回合开场叙事。不要等待玩家再次输入。';

  const isAwakeningEnterTrigger = userInput === '[系统] 踏入元素回响';
  let effectiveWorld: typeof state.世界 = state.世界;
  if (isAwakeningEnterTrigger && state.世界.元素回响邀请) {
    const entered = enterElementalEcho({
      ...state.世界,
      元素回响邀请: state.世界.元素回响邀请,
      进行中元素回响: state.世界.进行中元素回响 ?? '',
    });
    effectiveWorld = {
      ...entered,
      元素回响邀请: undefined,
      进行中元素回响: entered.进行中元素回响 as ElementId,
    };
  }
  const awakeningElementId = isAwakeningEnterTrigger ? effectiveWorld.进行中元素回响 : undefined;
  const awakeningInstruction = awakeningElementId
    ? `玩家选择进入元素回响（元素 ID: ${awakeningElementId}）。请按 elementalEcho 流程生成三道诘问，不要推进主剧情。`
    : '';

  // Abort previous request
  state.abortControllerRef.current?.abort();
  const abortController = new AbortController();
  state.abortControllerRef.current = abortController;
  const isCurrentWorkflow = () => state.abortControllerRef.current === abortController;
  const assertWorkflowActive = () => {
    if (abortController.signal.aborted || !isCurrentWorkflow()) {
      throw new DOMException('Workflow aborted', 'AbortError');
    }
  };

  deps.onBeforeSend();
  state.setLoading(true);
  setStreamingMessage('');
  state.setWorkflowHint('世界树召回 / 图鉴检索中');
  state.setWorkflowStatus('searching');
  state.setLiveRecallSummary('图鉴召回：检索中\n世界树召回：检索中');
  state.setLiveRecallFullContent('');
  pushQueueTask(state, 'main_story', 'pending', { detail: '正在调用主剧情模型。', cancellable: true });
  let pendingVariableStarted = false;
  let keepWorkflowHint = false;
  let rollbackHistoryOnAbort = state.chatHistory;
  let rollbackSnapshotOnAbort: 回合快照 | null = null;
  let visibilityPublisher: VisibilityBufferedPublisher | null = null;
  // Declared outside the stream setup so finally can always cancel a pending rAF commit.
  const streamMessageSetter = createRafCoalescedSetter(setStreamingMessage);
  const streamDelayController = createStreamingPreviewDelayController(abortController.signal);
  let recoveryJournal = createWorkflowRecoveryJournal(userInput, state.turnCount);

  const startTime = Date.now();

  try {
    await persistWorkflowRecoveryJournal(recoveryJournal);

    // 0-1. 本回合前置快照 + 用户消息入历史（已抽到 sendPreparationStage，M6 阶段 1）。
    //      懒加载（await import）以免该阶段被并进 app-core 首屏分包；
    //      新模块必须同时登记到 build/manualChunkStrategy.ts 的 allowlist。
    //      三个外层可变量由回调在**原始位置**回写（而非返回后统一赋值），
    //      以保证 recovery journal 落库失败等异常路径的行为与拆分前逐点一致。
    const { prepareSendTurn } = await import('./sendPreparationStage');
    const preparation = await prepareSendTurn({
      userInput,
      state,
      effectiveWorld,
      recoveryJournal,
      onSnapshotReady: (preTurnSnapshot) => {
        rollbackSnapshotOnAbort = preTurnSnapshot;
      },
      onJournalUpdated: (journal) => {
        recoveryJournal = journal;
      },
      onPurgedHistoryReady: (purgedHistory) => {
        rollbackHistoryOnAbort = purgedHistory;
      },
    });
    const { preTurnSnapshot, userMsg, updatedHistory } = preparation;

    // 2. Build system prompt（已抽到 mainPromptAssembly，M6 阶段 3）。
    //      懒加载 + 登记于 build/manualChunkStrategy.ts allowlist。
    const { runMainPromptAssembly } = await import('./mainPromptAssembly');
    const promptAssembly = await runMainPromptAssembly({
      state,
      userInput,
      updatedHistory,
      userMsg,
      mainStoryConfig,
      effectiveWorld,
      isOpeningSystemTrigger,
      isAwakeningEnterTrigger,
      assertWorkflowActive,
      openingInstruction,
      awakeningInstruction,
      rerollContext: deps.rerollContext,
    });
    let systemPrompt = promptAssembly.systemPrompt;
    let tavernV2Messages = promptAssembly.tavernV2Messages;
    const {
      awakeningPhase,
      storyWeavingDiagnostics,
      openingSteambirdForSave,
      openingSteambirdPreprocessed,
      irminsulEnabled,
      irminsulRecallEnabled,
      codexRecallEnabled,
      irminsulPreview,
      codexPreview,
      recallSummaryForTurn,
      recallFullContentForTurn,
      storyWeavingGate,
      npcLedgerSelection,
      moduleChatMessages,
      currentPresetV2,
      shouldTryTavernV2,
      tavernV2Error,
      recentHistory,
    } = promptAssembly;

    // 3. Prepare messages for API
    const apiMessages = buildNarrativeApiMessages({
      recentHistory,
      tavernMessages: tavernV2Messages,
      isOpeningSystemTrigger,
      openingInstruction,
      isAwakeningEnterTrigger,
      awakeningInstruction,
      awakeningPhase,
    });

    const deepSeekMainMode = state.gameSettings.deepSeekMainMode ?? 'off';
    const deepSeekMainActive = isDeepSeekMainConfig(mainStoryConfig) && deepSeekMainMode !== 'off';
    const deepSeekLockFormat = deepSeekMainActive && deepSeekMainMode === 'lock_format';
    const shouldUseCotFakeHistory =
      state.gameSettings.enableCotFakeHistory && !isOpeningSystemTrigger && !deepSeekMainActive;

    // Phase 4/7：从当前激活预设读取 assistant prefill
    // 正式 JSON 合同不使用 DeepSeek assistant prefill，避免缺少 JSON 起始字符。
    const currentPresetId = state.gameSettings.currentStPresetId;
    const allPresets = [
      ...getBuiltinPresets(),
      ...(state.gameSettings.stPresets ?? []),
    ];
    const currentPreset = currentPresetId
      ? allPresets.find((p) => p.id === currentPresetId)
      : undefined;
    const presetAssistantPrefill = currentPreset?.assistantPrefill;
    const usePresetPrefill = false;
    const effectivePrefixMode = false;
    const effectivePrefixContent = '';

    if (deepSeekMainActive) {
      apiMessages.push(创建聊天消息('user', DEEPSEEK_MAIN_FORMAT_GUARD));
    }
    if (deps.rerollContext && !isOpeningSystemTrigger) {
      apiMessages.push(创建聊天消息(
        'user',
        buildRerollGenerationGuard(deps.rerollContext.nonce, deps.rerollContext.previousResponse),
      ));
    }

    // 区E执法块(结构轮): 主剧情普通回合的最后一条 user 消息。开局/狭间评判/ST V2 消息链回合跳过
    // (各有自己的收尾协议)。
    if (!isOpeningSystemTrigger && !tavernV2Messages && awakeningPhase !== 'judgement') {
      apiMessages.push(创建聊天消息('user', buildTurnEnforcementBlock({
        playerName: state.旅人.姓名 || state.旅人.别名 || '无名旅者',
        wordCountTarget: state.gameSettings.wordCountTarget,
        codexEntries: codexPreview?.entries,
        storyWeavingActive: Boolean(state.gameSettings.剧情编织系统?.enabled && state.gameSettings.剧情编织系统.currentWindow),
      })));
    }

    // 3b. 格式伪历史注入：在消息序列最前面塞一对 user/assistant，提供最小合法 NarrativeTurn 范例。
    //     DeepSeek 专用模式下不注入这段伪装续聊，避免污染真实 user 输入并降低格式漂移。
    if (shouldUseCotFakeHistory) {
      apiMessages.unshift(
        创建聊天消息('user', NARRATIVE_TURN_EXAMPLE_USER),
        创建聊天消息('assistant', NARRATIVE_TURN_EXAMPLE_ASSISTANT),
      );
    }

    // 3c. ST 预设兼容：In-Chat depth 注入。
    //     injectionPosition=1 的模块按 injectionDepth 插入聊天历史。
    //     depth=0 末尾后，depth=1 末尾前，依此类推。
    //     Claude 方案 D：Claude 下 normalizeClaudeMessages 会抽取所有 system 消息到顶层，
    //     所以 Claude 下跳过 depth 注入。user/assistant 角色的 depth 模块追加到 systemPrompt 尾部。
    //     兜底：injectionPosition=0 的 user/assistant 模块（ST 预设很少用）也追加到 systemPrompt，
    //     避免内容丢失。
    //
    // 方案 B + C（v3 计划）：position 分流规则
    //   - position=0 + system role → 进 systemSection（在 injectPromptModules 里处理）
    //   - position=0 + user/assistant role → 追加 systemPrompt 尾部（方案 B，下方分支）
    //     简化处理：ST 语义里 position=0 + depth>0 表示插入 systemPrompt 中段，
    //     但我们的 systemPrompt 是字符串拼接，无法精确插入中段，统一追加到尾部。
    //     ST 预设中 position=0 + user/assistant + depth>0 极罕见，此简化可接受。
    //   - position=1 + user/assistant role（非 Claude）→ depth 注入（方案 C，下方分支）
    //   - position=1 + user/assistant role（Claude）→ 追加 systemPrompt 尾部（Claude 方案 D）
    const promptModuleInjection = injectPromptModuleMessages({
      systemPrompt,
      messages: apiMessages,
      moduleMessages: moduleChatMessages,
      provider: mainStoryConfig.provider,
    });
    systemPrompt = promptModuleInjection.systemPrompt;
    apiMessages.length = 0;
    apiMessages.push(...promptModuleInjection.messages);

    const shouldStreamMainRequest = state.gameSettings.enableStreaming && !isPageHidden();
    const mainRequestMode: 'stream' | 'non-stream' = shouldStreamMainRequest ? 'stream' : 'non-stream';

    // 4. Stream AI response（含自动重试循环）
    const streamingSession = createMainNarrativeStreamingSession({
      enabled: state.gameSettings.enableStreaming,
      signal: abortController.signal,
      set: streamMessageSetter.set,
      flush: streamMessageSetter.flush,
      wait: streamDelayController.wait,
      isHidden: isPageHidden,
      bufferWhenHidden: (text) => visibilityPublisher?.bufferWhenHidden(text) ?? false,
    });
    visibilityPublisher = typeof document === 'undefined'
      ? null
      : createVisibilityBufferedPublisher({
          source: createDocumentVisibilitySource(document),
          commit: streamingSession.acceptBufferedText,
        });
    const hasRequiredParty = getMissingPartyMembers('', state.NPC).length > 0;
    const maxAttempts = resolveMainNarrativeMaxAttempts({
      autoRetryOnError: state.gameSettings.autoRetryOnError,
      autoRetryCount: state.gameSettings.autoRetryCount,
      requiresValidationRepair: Boolean(deepSeekMainActive || deps.rerollContext || hasRequiredParty),
    });
    const narrativeRequest = await runValidatedMainNarrativeRequest({
      maxAttempts,
      signal: abortController.signal,
      request: async () => {
        streamingSession.reset();
        return requestMainNarrativeAttempt({
          config: mainStoryConfig,
          messages: apiMessages,
          systemPrompt,
          onDelta: streamingSession.onDelta,
          onStreamReset: streamingSession.reset,
          signal: abortController.signal,
          streaming: shouldStreamMainRequest,
          prefixMode: effectivePrefixMode,
          prefixContent: effectivePrefixContent,
          transformOutput: tavernV2Messages && currentPresetV2
            ? (text) => {
                const regexCleanup = applyTavernOutputRegexScripts(text || streamingSession.streamedText, currentPresetV2.preset);
                if (regexCleanup.applied.length === 0 || regexCleanup.text === text) return null;
                console.info('[ST V2] 已执行安全输出正则清理:', regexCleanup.applied);
                return regexCleanup.text;
              }
            : undefined,
        });
      },
      getMissingPartyMembers: (candidateText) => getMissingPartyMembers(candidateText, state.NPC),
      deepSeekValidation: deepSeekMainActive,
      ...(deps.rerollContext ? { rerollContext: deps.rerollContext } : {}),
      appendRetryInstruction: (instruction) => {
        apiMessages.push(创建聊天消息('user', instruction));
      },
      onValidationIssue: (issue) => {
        const source = issue.kind === 'missing_party'
          ? '队伍完整性校验'
          : issue.kind === 'reroll_similarity'
            ? '重roll相似度校验'
            : issue.kind === 'protocol'
              ? 'DeepSeek 主剧情协议校验'
              : '主剧情工作流';
        const errorMessage = issue.kind === 'empty'
          ? `返回空响应，触发自动重试。主剧情第 ${issue.attempt}/${issue.maxAttempts} 次（无可见正文块）。`
          : `主剧情第 ${issue.attempt}/${issue.maxAttempts} 次：${issue.detail}`;
        void appendApiErrorReport({
          source,
          config: mainStoryConfig,
          requestMode: mainRequestMode,
          error: new Error(errorMessage),
          responseText: issue.responseText || streamingSession.streamedText || streamingSession.previewText || '（空响应）',
        });
      },
      onValidationRetry: ({ kind, attempt, detail }) => {
        if (kind === 'empty') {
          console.warn(`[sendWorkflow] 第 ${attempt} 次返回空响应（无可见正文块），自动重试。`);
          return;
        }
        const queueDetail = kind === 'missing_party'
          ? `${detail}，正在自动补写。`
          : kind === 'reroll_similarity'
            ? '重roll结果与上一版过于相似，正在强制换写。'
            : `${detail}，正在自动重试。`;
        pushQueueTask(state, 'main_story', 'pending', {
          detail: queueDetail,
          failCount: attempt,
          retrying: true,
          cancellable: true,
        });
        console.warn(`[sendWorkflow] 第 ${attempt}/${maxAttempts} 次${detail}，自动重试。`);
      },
      isNonRetryableError: isNonRetryableAIError,
      onAttemptError: (innerErr) => {
        const innerMessage = innerErr instanceof Error ? innerErr.message : String(innerErr ?? '');
        const alreadyReportedByApiLayer =
          innerMessage.includes('API Error') ||
          innerMessage.includes('Failed to fetch') ||
          innerMessage.includes('No response body');
        if (!alreadyReportedByApiLayer) {
          void appendApiErrorReport({
            source: '主剧情工作流',
            config: mainStoryConfig,
            requestMode: mainRequestMode,
            error: innerErr,
            responseText: streamingSession.streamedText || streamingSession.previewText || '',
          });
        }
      },
      onErrorRetry: (innerErr, { attempt, maxAttempts: attemptLimit }) => {
        pushQueueTask(state, 'main_story', 'pending', {
          detail: `主剧情生成失败 ${attempt} 次，正在自动重试。`,
          failCount: attempt,
          retrying: true,
          cancellable: true,
        });
        console.warn(`[sendWorkflow] 第 ${attempt}/${attemptLimit} 次尝试失败，自动重试：`, innerErr);
      },
    });
    const result = narrativeRequest.result;
    const deepSeekProtocolIssuesForTurn = narrativeRequest.deepSeekProtocolIssues;
    const rerollSimilarityForTurn = narrativeRequest.rerollSimilarity;
    const rerollSimilarityRetried = narrativeRequest.rerollSimilarityRetried;

    visibilityPublisher?.flush();

    if (abortController.signal.aborted || !isCurrentWorkflow()) return;

    // 5. Build AI message
    const duration = (Date.now() - startTime) / 1000;
    pushQueueTask(state, 'main_story', 'success', {
      detail: `正文生成完成，用时 ${Math.round(duration)}s。`,
    });
    const cleanedParsed = sanitizeParsedResponse(result.parsed, state.gameSettings.额外功能);
    const parsedBody = normalizePlayerSpeechInBody({
      body: narrativeTurnBodyText(cleanedParsed),
      playerName: state.旅人.姓名 || state.旅人.别名 || '你',
      userInput,
    });
    const finalBody = stripLeakedHistoryMetaFromBody(sanitizeContaminatedText(parsedBody, state.gameSettings.额外功能)).trim();
    const displayText = finalBody;
    if (state.gameSettings.enableStreaming) {
      if (streamingSession.eventCount > 0) {
        await streamingSession.waitForPending();
      } else if (displayText.trim()) {
        await revealStreamingPreview(state, displayText, abortController.signal, {
          delayMs: 16,
          minChunks: 8,
        });
      }
      streamMessageSetter.flush('');
    } else {
      streamMessageSetter.cancel();
    }
    const finalBodyBlocks: NarrativeTurn['body'] = finalBody
      ? [{ kind: 'narration', text: finalBody }]
      : [];
    const validatedFactCandidates = revalidateFactCandidatesForBody(cleanedParsed.factCandidates, finalBodyBlocks);
    const validatedFactKeys = new Set(validatedFactCandidates.map((candidate) => `${candidate.domain}\u0000${candidate.fact}\u0000${candidate.evidence}`));
    const narrativeNormalizationWarnings = [
      ...getNarrativeTurnNormalizationWarnings(result.parsed),
      ...cleanedParsed.factCandidates
      .filter((candidate) => !validatedFactKeys.has(`${candidate.domain}\u0000${candidate.fact}\u0000${candidate.evidence}`))
      .map((candidate) => `事实证据未能与最终正文对齐，未进入变量结算：${candidate.domain}｜${candidate.fact}｜证据：${candidate.evidence}`),
    ];
    const parsedForDisplay: NarrativeTurn = {
      body: finalBodyBlocks,
      choices: cleanedParsed.choices.map((choice) => ({ ...choice })),
      factCandidates: validatedFactCandidates,
      continuation: {
        summary: cleanedParsed.continuation.summary,
        unresolved: [...cleanedParsed.continuation.unresolved],
      },
    };
    const tokenUsage = buildTurnTokenUsage({
      system: 'main_story',
      apiUsage: result.usage,
      systemPrompt,
      messages: apiMessages,
      outputText: result.fullText || displayText,
      provider: config.provider,
      model: config.model,
    });
    const previousDebugContext = [...updatedHistory]
      .reverse()
      .find((msg) => msg.role === 'assistant' && msg.debugContext?.systemPrompt)?.debugContext;
    const cachePrefixDiagnostics = buildCachePrefixDiagnostics({
      enabled: state.gameSettings.enableCacheDiagnostics === true,
      systemPrompt,
      messages: apiMessages,
      previous: previousDebugContext
        ? {
            systemPrompt: previousDebugContext.systemPrompt,
            messages: previousDebugContext.messages,
          }
        : undefined,
    });
    const aiMsg = 创建聊天消息('assistant', displayText, {
      gameTime: `${state.turnCount}`,
      parsedResponse: parsedForDisplay,
      inputTokens: tokenUsage.inputTokens,
      outputTokens: tokenUsage.outputTokens,
      tokenUsage,
      responseDurationSec: duration,
      preTurnSnapshot,
      debugContext: {
        systemPrompt,
        messages: apiMessages.map((msg) => ({ role: msg.role, content: msg.content })),
        deepSeekMainMode: deepSeekMainActive ? deepSeekMainMode : 'off',
        deepSeekCotFakeHistorySkipped: deepSeekMainActive && state.gameSettings.enableCotFakeHistory === true,
        deepSeekPrefixMode: deepSeekLockFormat,
        deepSeekProtocolIssues: deepSeekProtocolIssuesForTurn,
        narrativeNormalizationWarnings,
        deepSeekMainOriginalModel: result.deepSeekRecovery?.originalModel,
        deepSeekMainAdaptedModel: result.deepSeekRecovery?.fallbackModel
          ?? (result.deepSeekRecovery?.initialModel !== result.deepSeekRecovery?.originalModel
            ? result.deepSeekRecovery?.initialModel
            : undefined),
        stV2Attempted: shouldTryTavernV2,
        stV2Used: Boolean(tavernV2Messages),
        stV2FallbackReason: tavernV2Error instanceof Error ? tavernV2Error.message : tavernV2Error ? String(tavernV2Error) : undefined,
        rerollSimilarity: rerollSimilarityForTurn,
        rerollSimilarityRetried,
        cachePrefixDiagnostics,
        mainRequestMode,
        recallSummary: recallSummaryForTurn,
        recallFullContent: recallFullContentForTurn,
        irminsulRecallPreview: irminsulPreview?.previewText ?? '',
        irminsulRecallRawText: '',
        irminsulRecallUsedModel: irminsulPreview?.usedModel === true,
        codexRecallPreview: formatCodexDiagnosticsPreview(codexPreview),
        codexRecallInjection: codexRecallEnabled ? (codexPreview?.injection ?? '') : '',
        codexRecallRawText: '',
        codexRecallUsedModel: false,
        npcLedgerInjection: buildNpcLedgerDebug(npcLedgerSelection),
        npcLedgerSelectionRaw: npcLedgerSelection,
        recallPreview: [
          irminsulPreview?.previewText ?? '',
          storyWeavingGate
            ? `剧情编织门禁：${storyWeavingGate.mode}｜第 ${storyWeavingGate.分段组号 ?? '?'} 段｜${storyWeavingGate.reasons.join('；') || '无命中理由'}`
            : '',
          storyWeavingDiagnostics
            ? [
              `剧情编织注入健康：${storyWeavingDiagnostics.健康状态}`,
              `剧情编织实际注入：第 ${storyWeavingDiagnostics.当前分段组号} 段「${storyWeavingDiagnostics.当前分段标题}」｜${storyWeavingDiagnostics.当前分段运行状态}`,
              storyWeavingDiagnostics.归档锚点标题 ? `已跳过归档锚点：第 ${storyWeavingDiagnostics.归档锚点组号} 段「${storyWeavingDiagnostics.归档锚点标题}」` : '',
              storyWeavingDiagnostics.前一分段标题 ? `历史承接段：${storyWeavingDiagnostics.前一分段标题}` : '',
              storyWeavingDiagnostics.下一分段标题 ? `下一段预热：${storyWeavingDiagnostics.下一分段标题}` : '',
              storyWeavingDiagnostics.检查项.length ? `注入检查：${storyWeavingDiagnostics.检查项.join('；')}` : '',
            ].filter(Boolean).join('\n')
            : '',
          formatCodexDiagnosticsPreview(codexPreview),
          formatNpcLedgerPreview(npcLedgerSelection),
        ].filter(Boolean).join('\n\n'),
      },
    });
    recoveryJournal = updateWorkflowRecoveryJournal(recoveryJournal, {
      phase: 'narrative_received',
      assistantMessageId: aiMsg.id,
      pendingNarrative: parsedForDisplay,
    });
    await persistWorkflowRecoveryJournal(recoveryJournal);
    let finalHistory = [...updatedHistory, aiMsg];
    // assistant 消息已携带 preTurnSnapshot，清掉 user 消息上的，避免存档膨胀
    const userMsgIdx = finalHistory.findIndex((m) => m.id === userMsg.id);
    if (userMsgIdx >= 0 && finalHistory[userMsgIdx]?.preTurnSnapshot) {
      finalHistory = finalHistory.map((m, i) => i === userMsgIdx ? { ...m, preTurnSnapshot: undefined } : m);
    }
    finalHistory = compactChatHistoryForLongSession(finalHistory);
    streamMessageSetter.flush('');
    state.setLoading(false);
    state.setPendingVariable(true);
    pendingVariableStarted = true;

    // 6. Update memory
    pushQueueTask(state, 'memory', 'pending', { detail: '正在写入即时记忆并检查压缩阈值。' });
    const memorySettlement = await settlePostNarrativeMemory({
      memory: state.记忆,
      irminsul: state.世界树,
      userInput,
      narrativeSummary: parsedForDisplay.continuation.summary,
      body: displayText,
      turn: state.turnCount,
      settings: state.gameSettings.记忆系统 ?? 创建默认记忆系统设置(),
      mainConfig: config,
      signal: abortController.signal,
    });
    assertWorkflowActive();
    let mem = memorySettlement.memory;
    const irminsulWithCompression = memorySettlement.irminsul;
    pushQueueTask(state, 'memory', memorySettlement.feedback.status, {
      detail: memorySettlement.feedback.detail,
      failCount: memorySettlement.feedback.failCount,
      retryHint: memorySettlement.feedback.retryHint,
    });

    // 7 / 7a / 7b. 先在独立阶段结算世界事实、元素回响与天气，
    // 再把得到的本地快照交给变量模型，避免后续提交覆盖本回合变化。
    const narrativeWorldStage = applyNarrativeWorldStage({
      world: effectiveWorld,
      traveler: state.旅人,
      factCandidates: parsedForDisplay.factCandidates,
      rawResponseText: result.fullText || displayText,
    });
    let worldAfter: typeof state.世界 = narrativeWorldStage.world;
    let travelerAfter: typeof state.旅人 = narrativeWorldStage.traveler;
    const worldFactCandidates = narrativeWorldStage.worldFacts;

    result.fullText = '';
    result.parsed = createEmptyNarrativeTurn();
    result.usage = undefined;
    apiMessages.length = 0;
    systemPrompt = '';
    streamingSession.reset();
    tavernV2Messages = null;

    // 8.5 变量模型校准（已抽到 variableCalibrationStage，M6 阶段 2）。
    //      懒加载 + 新模块登记于 build/manualChunkStrategy.ts allowlist；
    //      recoveryJournal 由回调在原始位置回写，保证异常路径行为与拆分前逐点一致。
    const { runVariableCalibrationStage } = await import('./variableCalibrationStage');
    const variableCalibration = await runVariableCalibrationStage({
      state,
      userInput,
      config,
      abortController,
      assertWorkflowActive,
      isCurrentWorkflow,
      isOpeningSystemTrigger,
      effectiveWorld,
      displayText,
      parsedForDisplay,
      aiMsg,
      openingSteambirdForSave,
      openingSteambirdPreprocessed,
      storyWeavingGate,
      irminsulEnabled,
      irminsulRecallEnabled,
      irminsulPreview,
      irminsulWithCompression,
      worldAfter,
      travelerAfter,
      worldFactCandidates,
      finalHistory,
      mem,
      recoveryJournal,
      onJournalUpdated: (journal) => {
        recoveryJournal = journal;
      },
    });
    finalHistory = variableCalibration.finalHistory;
    mem = variableCalibration.mem;
    const {
      variableOverrides,
      committedSettlementGame,
      npcAfterCompression,
      memoryAfterStoryProgress,
      storyWeavingForSave,
      codexAfterRuntimeUnlock,
      steambirdAfterGeneration,
      irminsulAfterTurnRecall,
      courierAfterFallbackSeed,
      finalHistoryForSave,
    } = variableCalibration;
      // 9.5 元素附着与反应结算（G1 极简版）：从正文检测元素应用，更新场面附着并记录反应事件。
      // 熟练度只记旅行者本人施放的元素（主语过滤），避免敌人的元素攻击被算到旅行者头上。
      const travelerForMastery = variableOverrides?.旅人 ?? state.旅人;
      const elementalSettlement = settlePostTurnElements({
        body: displayText,
        traveler: travelerForMastery,
        travelerNames: [
          committedSettlementGame.旅行者.姓名,
          committedSettlementGame.旅行者.别名,
        ],
        field: committedSettlementGame.叙事.元素场面,
        events: committedSettlementGame.叙事.元素事件,
        turn: committedSettlementGame.turnCount,
      });
      const travelerAfterMastery = elementalSettlement.traveler;
      const masteryGains = elementalSettlement.masteryGains;
      if (masteryGains.length) {
        state.set旅人(travelerAfterMastery);
        pushQueueTask(state, 'variable', 'success', {
          detail: `本回合使用了 ${masteryGains.map((element) => ELEMENT_NAMES[element]).join('、')}，元素熟练度 +${elementalSettlement.masteryGainPerTurn}。`,
        });
      }
      if (elementalSettlement.fieldChanged) {
        state.updateGameState((current) => ({
          ...current,
          叙事: {
            ...current.叙事,
            元素场面: elementalSettlement.field,
            元素事件: elementalSettlement.events,
          },
        }));
      }

      // 10. Auto-save —— 每回合只在后台队列收尾写一次，避免正文/变量阶段重复生成多条自动存档。
      if (state.gameSettings.enableAutoSaveEveryTurn) {
        pushQueueTask(state, 'autosave', 'pending', { detail: '正在写入本回合自动存档。' });
      }
      await runPostTurnAutosaveTask({
        enabled: state.gameSettings.enableAutoSaveEveryTurn,
        build: () => {
          const variableBatchesForSave = compactVariableBatchHistory(variableOverrides?.batch
            ? [...state.variableBatches, variableOverrides.batch]
            : state.variableBatches);
          return buildSavePayload(state, 'auto', {
            chatHistory: finalHistoryForSave,
            记忆: memoryAfterStoryProgress,
            世界树: irminsulAfterTurnRecall,
            手机: courierAfterFallbackSeed,
            背包: committedSettlementGame.背包,
            旅人: travelerAfterMastery ?? variableOverrides?.旅人,
            世界: variableOverrides?.世界,
            NPC: npcAfterCompression,
            蒸汽鸟报: steambirdAfterGeneration ?? variableOverrides?.蒸汽鸟报,
            剧情: variableOverrides?.剧情,
            剧情编织: storyWeavingForSave,
            图鉴: codexAfterRuntimeUnlock,
            variableBatches: variableBatchesForSave,
            queueTasks: state.queueTasks,
            turnCount: state.turnCount + 1,
          }, committedSettlementGame);
        },
        assertActive: assertWorkflowActive,
        persist: saveGame,
        commit: commitActiveSaveTreeMeta,
        markSaved: () => {
          pushQueueTask(state, 'autosave', 'success', { detail: '本回合自动存档完成。' });
          state.setHasSave(true);
        },
      });

      recoveryJournal = updateWorkflowRecoveryJournal(recoveryJournal, { phase: 'autosave_committed' });
      await persistWorkflowRecoveryJournal(recoveryJournal);

    await saveSettings({
      theme: state.currentTheme,
      apiSettings: state.apiSettings,
      gameSettings: state.gameSettings,
      worldbooks: state.worldbooks,
    });
    await clearWorkflowRecoveryJournal(recoveryJournal.workflowId);
  } catch (err: unknown) {
    if ((err as Error).name === 'AbortError' || abortController.signal.aborted) {
      const abortDisposition = await applyAbortedWorkflowPolicy({
        phase: recoveryJournal.phase,
        rollback: async () => {
          state.setChatHistory(rollbackHistoryOnAbort);
          if (rollbackSnapshotOnAbort) {
            const rollbackStoryWeaving = restorePreTurnSnapshot(state, rollbackSnapshotOnAbort);
            await saveSetting('storyWeavingSystem', buildPersistedStoryWeavingSystem(rollbackStoryWeaving));
          }
        },
        clearJournal: () => clearWorkflowRecoveryJournal(recoveryJournal.workflowId),
      });
      if (abortDisposition === 'rolled_back') {
        state.setWorkflowHint('已停止生成，本次输入已回到输入框，可修改后重新发送。');
      } else {
        state.setWorkflowHint('本回合结算已提交；后台工作已暂停，可从恢复入口继续归档与自动存档。');
      }
      state.setWorkflowStatus('');
      keepWorkflowHint = true;
    } else {
      console.error('Send workflow error:', err);
      keepWorkflowHint = true;
      const detail = err instanceof Error ? err.message : '主流程调用失败。';
      const alreadyReportedByApiLayer = Boolean(
        err && typeof err === 'object' && (err as { alreadyReportedByApiLayer?: boolean }).alreadyReportedByApiLayer,
      );
      if (!alreadyReportedByApiLayer) {
        void appendApiErrorReport({
          source: '主剧情工作流',
          config,
          requestMode: state.gameSettings.enableStreaming ? 'stream' : 'non-stream',
          error: err,
        });
      }
      state.setWorkflowHint(`主流程失败：${detail}`);
      state.setWorkflowStatus('');
      const failedTask = pushQueueTask(state, 'main_story', 'failed', {
        detail,
        failCount: state.gameSettings.autoRetryOnError ? Math.max(1, state.gameSettings.autoRetryCount) : 1,
      });
      pushToast({
        kind: 'error',
        title: '回合结算失败',
        detail,
        durationMs: 10000,
        action: {
          label: '重试本回合',
          run: () => {
            void retryQueueTask(state, () => config, failedTask, 'retry').catch(() => undefined);
          },
        },
      });
    }
  } finally {
    visibilityPublisher?.dispose();
    streamDelayController.dispose();
    streamMessageSetter.cancel();
    if (isCurrentWorkflow()) {
      state.setLoading(false);
      setStreamingMessage('');
      if (!keepWorkflowHint) {
        state.setWorkflowHint('');
        state.setWorkflowStatus('');
      }
      state.setPendingVariable(false);
      if (!pendingVariableStarted) {
        pushQueueTask(state, 'memory', 'idle', { detail: '主剧情未完成，本轮后台任务未启动。' });
        pushQueueTask(state, 'variable', 'idle', { detail: '主剧情未完成，本轮后台任务未启动。' });
        pushQueueTask(state, 'steambird', 'idle', { detail: '主剧情未完成，本轮后台任务未启动。' });
        pushQueueTask(state, 'autosave', 'idle', { detail: '主剧情未完成，本轮后台任务未启动。' });
      }
      state.abortControllerRef.current = null;
      deps.onAfterSend();
    }
  }
}

// ── 变量模型结算边界 ──

type VariableCalibrationParams = Omit<
  VariableSettlementParams,
  'currentGame' | 'settings' | 'npcRecords' | 'commitGame' | 'onFailure'
> & { state: UseGameStateReturn };

/**
 * Keep React/store wiring here while loading the model, fact derivation and
 * transaction implementation only after the narrative has completed.
 */
export async function runVariableCalibrationStep(
  params: VariableCalibrationParams,
): Promise<VariableSettlementResult | null> {
  const { state, ...settlement } = params;
  const { runVariableSettlementWorkflow } = await import('./variableSettlementWorkflow');
  return runVariableSettlementWorkflow({
    ...settlement,
    currentGame: state.game,
    settings: state.gameSettings,
    npcRecords: state.NPC,
    commitGame: (next) => state.updateGameState(() => next),
    onFailure: (detail) => pushQueueTask(state, 'variable', 'failed', { detail }),
  });
}
