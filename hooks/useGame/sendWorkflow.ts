// 本编排器只保留「立即需要」的静态依赖；每个 M6 阶段模块都走 `await import()` 懒加载，
// 并且必须在 `build/manualChunkStrategy.ts` 的 allowlist 里登记，否则会被 Rollup
// 并回 app-core 首屏分包。
//
// 特例（G3-C5）：`./mainNarrativeRequestStage` 曾经在这里有一条**静态 import**，
// 但它的四个导出在本文件里一个都没用到（tsc `--noUnusedLocals` 判 TS6192），
// 该静态边把整个 303 行的请求装配阶段强行钉进 app-core。删除该死 import 后，
// 它只被同样懒加载的 `mainNarrativeStreamingStage` / `apiMessagesStage` 引用，
// 因而回到真正的异步分包；本文件不再需要（也不应再有）任何指向它的 import。
import {
  readLiveGameState,
  toLegacyTurnCheckpoint,
  type UseGameStateReturn} from '@/hooks/useGameState';
import { type 聊天消息, type 回合快照 } from '@/models/chat';
import { narrativeTurnBodyText} from '@/models/teyvat/narrativeTurn';

import { appendApiErrorReport } from '@/services/ai/apiErrorReportService';

import { runSteambirdGenerationStep } from './steambirdWorkflow';
import { applyAbortedWorkflowPolicy, runCommittedSettlementRecovery, runPendingSettlementRecovery, type WorkflowResumeResult } from './recoveryResume';

import { saveSetting} from '@/services/dbService';
import {
  clearWorkflowRecoveryJournal,
  createWorkflowRecoveryJournal,
  persistWorkflowRecoveryJournal,
  type WorkflowRecoveryJournal} from '@/services/workflowRecovery';
import type { TeyvatGameState } from '@/models/teyvat/state';
import {
  type VisibilityBufferedPublisher} from '@/utils/visibilityBufferedPublisher';
import { createRafCoalescedSetter } from '@/utils/rafCoalescedSetter';
import { setStreamingMessage } from '@/utils/streamingMessageStore';
import { createStreamingPreviewDelayController } from '@/utils/streamingPreviewDelay';
import type { 变量命令, 变量命令批次 } from '@/models/variableCommand';
import { enterElementalEcho } from '@/services/elementalAttunementService';

import type { ElementId } from '@/models/teyvat/elements';

import type { API配置项 } from '@/models/settings';
import type { 队列任务记录 } from '@/models/queueTask';

import { buildPersistedStoryWeavingSystem } from '@/data/storyWeavingPreset';

import { type NPC记录 } from '@/models/npc';
import { restorePreTurnSnapshot } from './turnSnapshot';
import { getNsfwArchiveBlockReason } from '@/utils/nsfwArchivePolicy';

import { splitStreamingReveal } from './mainNarrativeStreamingSession';

import type { CodexEntry } from '@/models/teyvat/codex';

import { pushToast } from '@/utils/toastStore';

import { cancelPendingWorkflowTasks, pushWorkflowQueueTask as pushQueueTask } from './workflowQueue';
import { getActiveSaveTreeNodeId } from './saveLoadWorkflow';
import type {
  VariableSettlementParams,
  VariableSettlementResult} from './variableSettlementWorkflow';

export function stripLeakedHistoryMetaFromBody(body: string): string {
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

export function isPageHidden(): boolean {
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

export async function revealStreamingPreview(
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
    const outcome = await recovery.runPostSettlementRecoveryWorkflow(state, journal, committedOverride);
    // 守卫可能因「等待生图期间玩家读档 / 开新局」而放弃写回。此时绝不能把 journal 推进到
    // autosave_committed —— 那等于谎报「自动存档已完成」，下次恢复会跳过该回合的收尾。
    // 复用 ok:false 分支如实上报：调用方 recoveryResume 在 post.ok 为假时本就不会推进 journal。
    if (!outcome.committed) {
      return { ok: false, journal, error: 'RECOVERY_POST_SETTLEMENT_SUPERSEDED' };
    }
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
    currentState: readLiveGameState(state),
    allowPristineRoot: state.getGameSessionId() === 0,
    currentSaveTreeNodeId: getActiveSaveTreeNodeId(),
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
    allowPristineRoot: state.getGameSessionId() === 0,
    currentSaveTreeNodeId: getActiveSaveTreeNodeId(),
    // 必须是**活体根**：待恢复回合的身份校验（回合数 + 对话时间线归属）与提交时的 CAS
    // 都以它为基准；用 `state.game`（本次渲染的快照）会把同一份存档误判成「已换档」。
    currentState: readLiveGameState(state),
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
  const workflowSessionId = state.getGameSessionId();
  const isCurrentWorkflow = () => state.abortControllerRef.current === abortController;
  const assertWorkflowActive = () => {
    if (abortController.signal.aborted || !isCurrentWorkflow() || state.getGameSessionId() !== workflowSessionId) {
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
  // M6: 该变量的赋值已移入懒加载阶段（通过回调回写），控制流分析看不到闭包赋值，
  // 会把它窄化成 null；这里的显式加宽断言是为了让 finally 里的 dispose 仍可见其真实类型。
  let visibilityPublisher: VisibilityBufferedPublisher | null = null as VisibilityBufferedPublisher | null;
  // Declared outside the stream setup so finally can always cancel a pending rAF commit.
  const streamMessageSetter = createRafCoalescedSetter(setStreamingMessage);
  const streamDelayController = createStreamingPreviewDelayController(abortController.signal);
  let recoveryJournal = createWorkflowRecoveryJournal(userInput, state.turnCount, getActiveSaveTreeNodeId());

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

    // 3. Prepare messages for API（已抽到 apiMessagesStage）。懒加载 + 登记 allowlist。
    const { runApiMessagesStage } = await import('./apiMessagesStage');
    const apiMessagesStage = await runApiMessagesStage({
      state,
      isOpeningSystemTrigger,
      isAwakeningEnterTrigger,
      openingInstruction,
      awakeningInstruction,
      awakeningPhase,
      mainStoryConfig,
      tavernV2Messages,
      codexPreview,
      recentHistory,
      moduleChatMessages,
      rerollContext: deps.rerollContext,
      buildTurnEnforcementBlock,
      isDeepSeekMainConfig,
      isPageHidden,
      NARRATIVE_TURN_EXAMPLE_USER,
      NARRATIVE_TURN_EXAMPLE_ASSISTANT,
      systemPrompt,
      onSystemPromptUpdated: (prompt) => {
        systemPrompt = prompt;
      },
    });
    const {
      apiMessages,
      deepSeekMainActive,
      deepSeekMainMode,
      deepSeekLockFormat,
      effectivePrefixMode,
      effectivePrefixContent,
      shouldStreamMainRequest,
      mainRequestMode,
    } = apiMessagesStage;

    // 4. Stream AI response（已抽到 mainNarrativeStreamingStage，M6 阶段 4）。
    //    该块含两个顶层 return（结束整个 executeSendWorkflow），现由早退信号承接。
    const { runMainNarrativeStreamingStage } = await import('./mainNarrativeStreamingStage');
    const streamingStage = await runMainNarrativeStreamingStage({
      state,
      abortController,
      isCurrentWorkflow,
      deepSeekMainActive,
      systemPrompt,
      tavernV2Messages,
      apiMessages,
      currentPresetV2,
      rerollContext: deps.rerollContext,
      streamMessageSetter,
      streamDelayController,
      mainStoryConfig,
      shouldStreamMainRequest,
      effectivePrefixMode,
      effectivePrefixContent,
      mainRequestMode,
      visibilityPublisher,
      onVisibilityPublisherChanged: (publisher) => {
        visibilityPublisher = publisher;
      },
    });
    if (streamingStage.earlyReturn) return streamingStage.returnValue;
    const {
      streamingSession,
      result,
      deepSeekProtocolIssuesForTurn,
      rerollSimilarityForTurn,
      rerollSimilarityRetried,
    } = streamingStage;

    // 5. Build AI message（已抽到 aiMessageStage，M6 阶段 5）。懒加载 + 原始位置回写外层可变量。
    const { runAiMessageStage } = await import('./aiMessageStage');
    const aiMessageStage = await runAiMessageStage({
      state,
      userInput,
      startTime,
      abortController,
      streamMessageSetter,
      systemPrompt,
      tavernV2Messages,
      apiMessages,
      mainRequestMode,
      deepSeekMainActive,
      streamingSession,
      result,
      rerollSimilarityRetried,
      storyWeavingDiagnostics,
      storyWeavingGate,
      tavernV2Error,
      irminsulPreview,
      codexPreview,
      codexRecallEnabled,
      npcLedgerSelection,
      config,
      updatedHistory,
      userMsg,
      preTurnSnapshot,
      deepSeekMainMode,
      deepSeekLockFormat,
      deepSeekProtocolIssuesForTurn,
      rerollSimilarityForTurn,
      shouldTryTavernV2,
      recallSummaryForTurn,
      recallFullContentForTurn,
      recoveryJournal,
      pendingVariableStarted,
      onJournalUpdated: (journal) => {
        recoveryJournal = journal;
      },
      onPendingVariableStartedChanged: (started) => {
        pendingVariableStarted = started;
      },
    });
    let finalHistory = aiMessageStage.finalHistory;
    const { displayText, parsedForDisplay, aiMsg } = aiMessageStage;

    // 6. Update memory（已抽到 memoryUpdateStage）。懒加载 + 登记 allowlist。
    const { runMemoryUpdateStage } = await import('./memoryUpdateStage');
    const memoryUpdateStage = await runMemoryUpdateStage({
      state,
      userInput,
      config,
      displayText,
      parsedForDisplay,
      abortController,
      assertWorkflowActive,
    });
    let mem = memoryUpdateStage.mem;
    const { irminsulWithCompression } = memoryUpdateStage;

    // 7 / 7a / 7b. 先在独立阶段结算世界事实、元素回响与天气，（已抽到 worldCommitStage）。懒加载 + 登记 allowlist。
    const { runWorldCommitStage } = await import('./worldCommitStage');
    const worldCommitStage = await runWorldCommitStage({
      state,
      effectiveWorld,
      parsedForDisplay,
      displayText,
      result,
      apiMessages,
      streamingSession,
      systemPrompt,
      tavernV2Messages,
      onResultMutated: (current) => {
        void current;
      },
      onApiMessagesCleared: (messages) => {
        void messages;
      },
      onSystemPromptUpdated: (prompt) => {
        systemPrompt = prompt;
      },
      onTavernV2MessagesUpdated: (messages) => {
        tavernV2Messages = messages;
      },
    });
    let worldAfter = worldCommitStage.worldAfter;
    let travelerAfter = worldCommitStage.travelerAfter;
    const {
      worldFactCandidates,
    } = worldCommitStage;

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
    // 9.5 元素附着与反应结算（G1 极简版）（已抽到 elementalSettlementStage）。懒加载 + 登记 allowlist。
    const { runElementalSettlementStage } = await import('./elementalSettlementStage');
    const elementalSettlementStage = await runElementalSettlementStage({
      state,
      displayText,
      committedSettlementGame,
      variableOverrides,
    });
    const {
      travelerAfterMastery,
    } = elementalSettlementStage;

    // 10. Auto-save（已抽到 autoSaveStage）。懒加载 + 登记 allowlist。
    const { runAutoSaveStage } = await import('./autoSaveStage');
    const autoSaveStage = await runAutoSaveStage({
      state,
      assertWorkflowActive,
      committedSettlementGame,
      variableOverrides,
      steambirdAfterGeneration,
      travelerAfterMastery,
      finalHistoryForSave,
      memoryAfterStoryProgress,
      irminsulAfterTurnRecall,
      courierAfterFallbackSeed,
      npcAfterCompression,
      storyWeavingForSave,
      codexAfterRuntimeUnlock,
      recoveryJournal,
      onJournalUpdated: (journal) => {
        recoveryJournal = journal;
      },
    });
  } catch (err: unknown) {
    if (state.getGameSessionId() !== workflowSessionId) {
      // 读档/新开局已让旧工作流失效：不能把旧回合快照回滚进新档，也不能写入旧任务提示。
    } else if ((err as Error).name === 'AbortError' || abortController.signal.aborted) {
      const abortDisposition = await applyAbortedWorkflowPolicy({
        phase: recoveryJournal.phase,
        sessionStillCurrent: () => state.getGameSessionId() === workflowSessionId,
        rollback: async () => {
          state.setChatHistory(rollbackHistoryOnAbort);
          if (rollbackSnapshotOnAbort) {
            const rollbackStoryWeaving = restorePreTurnSnapshot(state, rollbackSnapshotOnAbort);
            await saveSetting('storyWeavingSystem', buildPersistedStoryWeavingSystem(rollbackStoryWeaving));
          }
        },
        clearJournal: () => clearWorkflowRecoveryJournal(recoveryJournal.workflowId),
      });
      state.setQueueTasks((previous) => cancelPendingWorkflowTasks(previous, state.turnCount));
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
      if (!keepWorkflowHint && state.getGameSessionId() === workflowSessionId) {
        state.setWorkflowHint('');
        state.setWorkflowStatus('');
      }
      state.setPendingVariable(false);
      if (!pendingVariableStarted && state.getGameSessionId() === workflowSessionId) {
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
> & {
  state: UseGameStateReturn;
  /**
   * 结算开始那一刻的活体根（由调用方 `readLiveGameState(state)` 同步探测）。
   * 缺省时本函数自行探测，用于 recovery / 重试等不经过 `variableCalibrationStage` 的入口。
   */
  liveBaseGame?: TeyvatGameState;
};

/**
 * Keep React/store wiring here while loading the model, fact derivation and
 * transaction implementation only after the narrative has completed.
 */
export async function runVariableCalibrationStep(
  params: VariableCalibrationParams,
): Promise<VariableSettlementResult | null> {
  const { state, liveBaseGame, ...settlement } = params;
  const { runVariableSettlementWorkflow } = await import('./variableSettlementWorkflow');
  const { rebaseSettlementState, isSettlementBaseCompatibleWithLiveRoot } = await import('@/utils/settlementRebase');
  const { capturePostSettlementSaveToken, isSamePostSettlementSave } = await import('./postSettlementRecoveryWorkflow');
  // 结算基线必须是**活体根**，不能用 `state.game`：
  // `UseGameStateReturn` 是每次渲染一份的快照，`state.game` 还是「本回合 user 消息入栈之前」的旧根，
  // 拿它做 CAS 基准会与提交那一刻的活体根必然不等（对话少 1 条）→ 每一次结算都被误判成
  // 「等待期间换了存档」而整体丢弃，症状是 turnCount 不再增长（聊天/存档回合数卡住、
  // 手机回合分割线全部消失）。详见 `readLiveGameState` 与 `utils/settlementRebase.ts` 的注释。
  const liveBase = liveBaseGame ?? readLiveGameState(state);
  // 结算基线必须属于**当前活体存档**：恢复路径会把 journal 里那一回合的冻结快照当基线传进来，
  // 而它属于「当时那份存档」。玩家若已读入别的存档，CAS（活体 vs 活体）拦不住 ——
  // 于是旧档整根被写进新档。这里在调用模型**之前**就拒绝，既省一次付费调用也守住数据。
  if (settlement.baseGameSnapshot && !isSettlementBaseCompatibleWithLiveRoot(settlement.baseGameSnapshot, liveBase)) {
    pushQueueTask(state, 'variable', 'failed', {
      detail: '本次变量结算的基线来自另一份存档（等待期间已切换存档），已放弃，未写入任何内容。',
    });
    return null;
  }
  const saveToken = capturePostSettlementSaveToken(liveBase);
  return runVariableSettlementWorkflow({
    ...settlement,
    currentGame: liveBase,
    settings: state.gameSettings,
    npcRecords: state.NPC,
    // 提交分两步，都在同一个同步块里（中间没有 await，所以读到的活体根就是写入时的活体根）：
    // 1) 先同步读活体根做 CAS：存档身份变了（等待期间读档/开新局）→ 整份拒绝并**如实上报未写入**
    //    （返回 false，让上游丢弃 committedGame，不再拿未落地的结算去自动存档）；
    // 2) 再按顶层切片与 `liveBase` 比对，玩家在等待期间改过的切片以玩家为准（不再静默丢弃）。
    commitGame: (next) => {
      const liveNow = readLiveGameState(state);
      if (!isSamePostSettlementSave(capturePostSettlementSaveToken(liveNow), saveToken)) {
        pushQueueTask(state, 'variable', 'failed', {
          detail: '结算期间存档已切换，本次变量结算未写入（已放弃，避免污染新存档）。',
        });
        return false;
      }
      const { state: merged, preservedSlices } = rebaseSettlementState({ ancestor: liveBase, next, current: liveNow });
      // 队列提示必须在根状态写入**之后**补：写入会用结算产出的 `后台队列` 覆盖这一条。
      state.updateGameState(() => merged);
      if (preservedSlices.length) {
        pushQueueTask(state, 'variable', 'pending', {
          detail: `结算完成；等待期间被改动的 ${preservedSlices.join('、')} 以最新值为准（未被本次结算覆盖）。`,
        });
      }
      return true;
    },
    onFailure: (detail) => pushQueueTask(state, 'variable', 'failed', { detail }),
  });
}
