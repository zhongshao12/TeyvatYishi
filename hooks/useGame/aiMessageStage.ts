/**
 * M6 拆分 · 阶段 5：构建 AI 消息（原 `executeSendWorkflow` 内部步骤 5，
 * 原 `sendWorkflow.ts:1002-1146`，共 145 行）。
 *
 * 拆分原则：**纯搬运，不改行为**。
 *  - 被搬动的代码逐字保留（含原有换行与缩进）；
 *  - 原代码对 `recoveryJournal` 与 `pendingVariableStarted` 的写入，在**原始位置**通过回调回写外层，
 *    而不是"返回后统一赋值" —— 写入点与随后的 `await` 之间存在可抛错点，调用方的 catch/finally 会读它们；
 *  - 块内**没有顶层 return**；
 *  - 依赖类型从**产出者**推导（`PromptAssemblyResult[...]` / `ReturnType<typeof ...>`），而非手工猜测。
 */
import { createEmptyNarrativeTurn, narrativeTurnBodyText, type NarrativeTurn } from '@/models/teyvat/narrativeTurn';
import { getNarrativeTurnNormalizationWarnings, revalidateFactCandidatesForBody } from '@/services/ai/narrativeTurnParser';
import {
  clearWorkflowRecoveryJournal,
  createWorkflowRecoveryJournal,
  persistWorkflowRecoveryJournal,
  updateWorkflowRecoveryJournal,
  type WorkflowRecoveryJournal,
} from '@/services/workflowRecovery';
import { normalizePlayerSpeechInBody } from '@/utils/playerSpeechGuard';
import { sanitizeParsedResponse, sanitizeContaminatedText } from '@/utils/textSanitizer';
import { buildCachePrefixDiagnostics, buildTurnTokenUsage } from './turnDiagnostics';
import {
  attachNpcLedgerUpdateDebug,
  buildNpcLedgerDebug,
  formatCodexDiagnosticsPreview,
  formatNpcLedgerPreview,
} from './turnDebugContext';
import { compactChatHistoryForLongSession, compactVariableBatchHistory } from '@/utils/longSessionRetention';
import { pushWorkflowQueueTask as pushQueueTask } from './workflowQueue';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { API配置项 } from '@/models/settings';
import type { 聊天消息, 回合快照 } from '@/models/chat';
import type { DeepSeek主剧情模式 } from '@/models/settings';
import type { MainPromptAssemblyResult } from './mainPromptAssembly';
import type { MainNarrativeRequestStageResult } from './mainNarrativeRequestStage';
import { createRafCoalescedSetter } from '@/utils/rafCoalescedSetter';
import { buildNarrativeApiMessages } from './promptModuleMessageInjection';
import { createMainNarrativeStreamingSession } from './mainNarrativeStreamingSession';
import { 创建聊天消息 } from '@/models/chat';
import { stripLeakedHistoryMetaFromBody } from './sendWorkflow';
import { revealStreamingPreview } from './sendWorkflow';

type PromptAssemblyResult = MainPromptAssemblyResult;
type NarrativeRequestResult = MainNarrativeRequestStageResult;

export interface AiMessageStageDeps {
  state: UseGameStateReturn;
  userInput: string;
  startTime: number;
  abortController: AbortController;
  streamMessageSetter: ReturnType<typeof createRafCoalescedSetter>;
  systemPrompt: string;
  tavernV2Messages: 聊天消息[] | null;
  apiMessages: ReturnType<typeof buildNarrativeApiMessages>;
  mainRequestMode: 'stream' | 'non-stream';
  deepSeekMainActive: boolean;
  streamingSession: ReturnType<typeof createMainNarrativeStreamingSession>;
  result: NarrativeRequestResult['result'];
  rerollSimilarityRetried: boolean;
  storyWeavingDiagnostics: PromptAssemblyResult['storyWeavingDiagnostics'];
  storyWeavingGate: PromptAssemblyResult['storyWeavingGate'];
  tavernV2Error: PromptAssemblyResult['tavernV2Error'];
  irminsulPreview: PromptAssemblyResult['irminsulPreview'];
  codexPreview: PromptAssemblyResult['codexPreview'];
  codexRecallEnabled: PromptAssemblyResult['codexRecallEnabled'];
  npcLedgerSelection: PromptAssemblyResult['npcLedgerSelection'];
  config: API配置项;
  updatedHistory: 聊天消息[];
  userMsg: 聊天消息;
  preTurnSnapshot: 回合快照;
  deepSeekMainMode: DeepSeek主剧情模式;
  deepSeekLockFormat: boolean;
  deepSeekProtocolIssuesForTurn: NarrativeRequestResult['deepSeekProtocolIssues'];
  rerollSimilarityForTurn: NarrativeRequestResult['rerollSimilarity'];
  shouldTryTavernV2: PromptAssemblyResult['shouldTryTavernV2'];
  recallSummaryForTurn: PromptAssemblyResult['recallSummaryForTurn'];
  recallFullContentForTurn: PromptAssemblyResult['recallFullContentForTurn'];
  recoveryJournal: WorkflowRecoveryJournal;
  pendingVariableStarted: boolean;
  /** 在原始位置回写外层 recoveryJournal。 */
  onJournalUpdated: (journal: WorkflowRecoveryJournal) => void;
  /** 在原始位置回写外层 pendingVariableStarted。 */
  onPendingVariableStartedChanged: (started: boolean) => void;
}

export async function runAiMessageStage(deps: AiMessageStageDeps) {
  const {
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
  } = deps;
  let recoveryJournal = deps.recoveryJournal;
  let pendingVariableStarted = deps.pendingVariableStarted;

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
    deps.onJournalUpdated(recoveryJournal);
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
    deps.onPendingVariableStartedChanged(pendingVariableStarted);

  return {
    displayText,
    parsedForDisplay,
    aiMsg,
    finalHistory,
    recoveryJournal,
    pendingVariableStarted,
  };
}
