import { flushSync } from 'react-dom';
import {
  applyLegacyGameStateOverrides,
  readLiveGameState,
  toLegacyTurnCheckpoint,
  type UseGameStateReturn,
} from '@/hooks/useGameState';
import { rebaseSettlementState } from '@/utils/settlementRebase';
import { narrativeTurnBodyText } from '@/models/teyvat/narrativeTurn';
import { normalizeTeyvatGameState, type TeyvatGameState } from '@/models/teyvat/state';
import { saveGame } from '@/services/dbService';
import { buildIrminsulArchiveEntry } from '@/services/irminsulArchive';
import { deriveCommittedQuestArchiveFacts } from '@/services/questService';
import type { WorkflowRecoveryJournal } from '@/services/workflowRecovery';
import { archiveCommittedQuestSettlement } from './questWorkflow';
import { buildFallbackCourierSeed } from './courierBackgroundJobs';
import { processScheduledCourierSeeds } from './courierWorkflow';
import { mergeIrminsulMemories } from './postTurnIrminsulTask';
import { buildSavePayload, commitActiveSaveTreeMeta } from './saveLoadWorkflow';
import { runTrackedSave, saveStatusStore } from '@/utils/saveStatus';
import { runSteambirdGenerationStep } from './steambirdWorkflow';

/**
 * 存档身份令牌。
 *
 * 只取「读入另一份存档 / 开新局一定会变、而同一存档内的 手机 / NPC 等增量更新不会变」的真实字段：
 * 回合数 + 对话条目数 + 对话条目 id 序列指纹。
 * 不取 `state.game` 的对象引用：任何一次 updateGameState 都会换引用，会误判成「换存档」。
 * 指纹覆盖全部条目（FNV-1a）而不是只看最后一条：旧存档 / 导入存档的 id 可能很短且跨存档重名，
 * 只看尾巴会把「另一份存档」误判成「同一份存档」。
 */
export interface PostSettlementSaveToken {
  turnCount: number;
  conversationLength: number;
  conversationFingerprint: string;
}

function fingerprintConversationIds(entries: readonly { id: string }[]): string {
  let hash = 0x811c9dc5;
  for (const entry of entries) {
    const id = String(entry.id);
    for (let index = 0; index < id.length; index += 1) {
      hash ^= id.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    // 条目分隔符，避免 ['ab','c'] 与 ['a','bc'] 撞成同一个指纹。
    hash ^= 0x1f;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function capturePostSettlementSaveToken(game: TeyvatGameState): PostSettlementSaveToken {
  const entries = game.对话.entries;
  return {
    turnCount: Math.trunc(Number(game.turnCount) || 0),
    conversationLength: entries.length,
    conversationFingerprint: fingerprintConversationIds(entries),
  };
}

export function isSamePostSettlementSave(
  left: PostSettlementSaveToken,
  right: PostSettlementSaveToken,
): boolean {
  return left.turnCount === right.turnCount
    && left.conversationLength === right.conversationLength
    && left.conversationFingerprint === right.conversationFingerprint;
}

/**
 * 提交恢复尾流程算出的 backgroundState，但只在「提交那一刻的活体存档」仍是开始恢复时的同一份存档时。
 *
 * 为什么不能先比较再 `replaceGameState`：`UseGameStateReturn` 是**每次渲染一份的快照**，
 * await 之后 `state.game` 还是旧值，读档并不会改变它；`replaceGameState(next)` 又是无条件覆盖，
 * 于是玩家在等待期间读入的存档会被旧快照整体覆盖（数据损坏）。
 * 只有 setState 的 updater 形式能在**提交那一刻**读到 React 的真实存档（current），
 * 所以这里用 updater 做 CAS；`flushSync` 用来同步拿到 CAS 结果，
 * 避免出现「状态没写、却把旧快照落盘」的二次损坏（落盘会挂到新存档的存档树节点下）。
 *
 * 通过 CAS 之后也**不能整根替换**（对抗审查 2026-09-20 的 C 项）：本流程前面有长达数十秒的
 * 正文生图 await，玩家在此期间对背包 / NPC / 任务 / 相册的改动会随整根替换被静默回退
 * —— 与第二轮审计 A3 在变量结算提交处修掉的是同一类缺陷。这里复用同一套并发规则：
 * 以开始恢复时的活体根（`ancestor`）为祖先，等待期间被改过的切片以活体值为准。
 *
 * @returns 真正提交的合并根；身份失效时为 null。自动存档必须用这份根。
 */
export function commitPostSettlementBackgroundState(
  state: UseGameStateReturn,
  token: PostSettlementSaveToken,
  next: TeyvatGameState,
  ancestor: TeyvatGameState,
  expectedSessionId?: number,
): TeyvatGameState | null {
  let committed: TeyvatGameState | null = null;
  flushSync(() => {
    state.updateGameState((current) => {
      if (expectedSessionId !== undefined && state.getGameSessionId() !== expectedSessionId) return current;
      if (!isSamePostSettlementSave(capturePostSettlementSaveToken(current), token)) return current;
      committed = rebaseSettlementState({ ancestor, next, current }).state;
      return committed;
    });
  });
  return committed;
}

/**
 * Idempotent work after the settlement boundary. This module is lazy-loaded
 * only after an interrupted committed turn needs recovery.
 */
export async function runPostSettlementRecoveryWorkflow(
  state: UseGameStateReturn,
  journal: WorkflowRecoveryJournal,
  committedOverride?: TeyvatGameState,
): Promise<{ committed: boolean }> {
  if (journal.phase !== 'settlement_committed') return { committed: false };
  // 本流程唯一的长耗时 await（正文生图，可能数十秒）之前先钉住存档身份与**活体根**；
  // 期间的读档 / 开新局会在提交时被下文的 CAS 守卫拦下，
  // 期间的其它改动（玩家在背包 / NPC / 任务面板上的操作）会在提交时按切片合并保留。
  const liveBase = readLiveGameState(state);
  const sessionId = state.getGameSessionId();
  const saveToken = capturePostSettlementSaveToken(liveBase);
  const committed = normalizeTeyvatGameState(committedOverride ?? journal.committedState ?? state.game);
  const committedHistory = committed.对话.entries;
  const assistant = journal.assistantMessageId
    ? committedHistory.find((message) => message.id === journal.assistantMessageId && message.role === 'assistant')
    : [...committedHistory].reverse().find((message) => message.role === 'assistant');
  const body = assistant
    ? (assistant.structuredResponse ? narrativeTurnBodyText(assistant.structuredResponse) : assistant.content.trim())
    : '';
  const assistantIndex = assistant ? committedHistory.findIndex((message) => message.id === assistant.id) : -1;
  const userInput = assistantIndex >= 0
    ? [...committedHistory.slice(0, assistantIndex)].reverse().find((message) => message.role === 'user')?.content.trim() || journal.input
    : journal.input;
  const turn = committed.turnCount;
  const stableNow = journal.startedAt;

  let steambird = committed.蒸汽鸟报;
  const steambirdSettings = state.gameSettings.蒸汽鸟报系统;
  const interval = Math.max(5, Math.min(10, Math.trunc(steambirdSettings?.generateIntervalTurns ?? 5) || 5));
  const sourceBody = `${userInput}\n${body}`.trim();
  const shouldRunSteambird = Boolean(
    body && steambirdSettings?.enabled && steambirdSettings.autoGenerate && (turn === 1 || turn % interval === 0),
  );
  const steambirdAlreadyApplied = steambird.articles.some((article) =>
    article.turn === turn && article.body.trim() === sourceBody);
  if (shouldRunSteambird && !steambirdAlreadyApplied) {
    const result = runSteambirdGenerationStep({
      current: steambird,
      publicFacts: [{ title: `第 ${turn} 回公开见闻`, detail: sourceBody }],
      turnCount: turn,
      now: stableNow,
    });
    if (result?.changed) steambird = result.steambird;
  }

  let irminsul = committed.世界树;
  const archiveExists = irminsul.entries.some((entry) => entry.turn === turn && entry.sourceText.trim() === body.trim());
  if (body && !archiveExists) {
    irminsul = mergeIrminsulMemories(irminsul, { entries: [buildIrminsulArchiveEntry({
      id: `irminsul_recovery_${journal.workflowId}`,
      title: `第 ${turn} 回记忆`,
      summary: assistant?.structuredResponse?.continuation.summary || body.slice(0, 360),
      sourceTurns: [turn],
      keywords: [
        committed.世界.当前地点,
        ...(assistant?.structuredResponse?.factCandidates ?? [])
          .filter((candidate) => candidate.domain === 'world')
          .map((candidate) => candidate.fact),
      ].filter((item): item is string => Boolean(item)).slice(0, 8),
      recordedAt: committed.世界.当前日期 || String(turn),
      archiveType: 'short',
      sourceText: body,
      turn,
    })] });
  }
  const questFacts = deriveCommittedQuestArchiveFacts(
    committed,
    assistant?.structuredResponse?.factCandidates
      .filter((candidate) => candidate.domain === 'quest')
      .map((candidate) => candidate.fact) ?? [],
    turn,
  );
  irminsul = archiveCommittedQuestSettlement(irminsul, committed, questFacts, turn);

  const legacy = toLegacyTurnCheckpoint({
    turnCount: committed.turnCount,
    pendingOpeningTrigger: null,
    traveler: committed.旅行者,
    npc: committed.NPC,
    album: committed.相册,
  });
  const traveler = legacy.旅人 as UseGameStateReturn['旅人'];
  const npcs = legacy.NPC as UseGameStateReturn['NPC'];
  const committedAlbum = legacy.相册 as UseGameStateReturn['相册'];
  let courier = processScheduledCourierSeeds(committed.手机, turn, stableNow).next;
  if (state.gameSettings.手机系统.enabled && state.gameSettings.手机系统.autoGenerateSeeds) {
    const fallbackSeed = buildFallbackCourierSeed({
      courier,
      npcs,
      turn,
      userInput,
      body,
      maxSeedsPerTurn: state.gameSettings.手机系统.maxSeedsPerTurn,
      contactCooldownTurns: state.gameSettings.手机系统.contactCooldownTurns,
    });
    if (fallbackSeed) {
      courier = {
        ...courier,
        deliverySeeds: [...courier.deliverySeeds, fallbackSeed],
        unreadTotal: courier.unreadTotal + 1,
      };
    }
  }

  let backgroundState = normalizeTeyvatGameState({
    ...committed,
    蒸汽鸟报: steambird,
    世界树: irminsul,
    手机: courier,
  });
  let conversation = committedHistory;
  let album = committedAlbum;
  const narrativeSettings = state.gameSettings.文生图系统?.正文生图;
  const alreadyHasImage = Boolean(assistant?.narrativeImages?.some((image) => image.status === 'done'));
  if (assistant && body && narrativeSettings?.enabled && narrativeSettings.mode === 'auto' && !alreadyHasImage) {
    const activeConfig = state.apiSettings.configs.find((config) => config.id === state.apiSettings.activeConfigId)
      ?? state.apiSettings.configs[0]
      ?? null;
    const imageWorkflow = await import('./narrativeImageWorkflow');
    const imageApiConfig = imageWorkflow.resolveNarrativeImageGenerationApi(state);
    if (imageApiConfig) {
      const generatedImages = await imageWorkflow.generateNarrativeImagesForMessage({
        state,
        messageId: assistant.id,
        body,
        tokenizerConfig: imageWorkflow.resolveNarrativeImageTokenizerConfig(state, activeConfig),
        imageApiConfig,
        turn,
        domainContext: {
          旅人: traveler,
          NPC: npcs,
          相册: album,
          onAlbumChange: (next) => { album = next; },
        },
        writeDomainState: false,
      });
      if (generatedImages?.length) {
        conversation = conversation.map((message) => message.id === assistant.id
          ? { ...message, narrativeImages: [...(message.narrativeImages ?? []), ...generatedImages] }
          : message);
      }
    }
  }
  backgroundState = applyLegacyGameStateOverrides({
    ...backgroundState,
    对话: { entries: conversation },
  }, { 相册: album });
  // 守卫：正文生图等待期间若玩家读档 / 开新局，活体存档已经不是这份 journal 的存档，
  // 旧快照绝不能写回去（也绝不落盘），直接放弃本次恢复尾流程。
  const savedRoot = commitPostSettlementBackgroundState(state, saveToken, backgroundState, liveBase, sessionId);
  if (!savedRoot) return { committed: false };

  const saveData = buildSavePayload(state, 'auto', undefined, savedRoot);
  const writeCommitted = await runTrackedSave(saveStatusStore, sessionId, savedRoot, 'auto', async () => {
    await saveGame(saveData);
    if (state.getGameSessionId() !== sessionId) return false;
    commitActiveSaveTreeMeta(saveData);
    state.setHasSave(true);
    return true;
  }, () => readLiveGameState(state), Boolean);
  return { committed: writeCommitted };
}
