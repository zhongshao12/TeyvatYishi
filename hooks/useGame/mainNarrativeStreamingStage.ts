/**
 * M6 拆分 · 阶段 4：主叙事流式请求与自动重试（原 `executeSendWorkflow` 内部步骤 4）。
 *
 * 与其它阶段的关键区别：本块含**两个顶层 `return`**，原语义是直接结束整个 `executeSendWorkflow`
 * （跳过后续步骤，但仍执行编排器的 catch/finally）。故改写为判别联合的早退信号：
 *   `{ earlyReturn: true, returnValue }` / `{ earlyReturn: false, returnValue: undefined, ...返回值 }`；
 * 调用方 `if (stage.earlyReturn) return stage.returnValue;` —— 语义等价。
 *
 * 其余代码**逐字保留**（`deps.rerollContext` 无需适配：模块形参本就叫 `deps`，同名属性可直接解析）；
 * `visibilityPublisher` 的写入在【原始位置】用回调回写外层。
 */
import { appendApiErrorReport } from '@/services/ai/apiErrorReportService';
import { isNonRetryableAIError } from '@/services/ai/deepSeekRecovery';
import { resolveMainNarrativeMaxAttempts } from '@/services/ai/mainNarrativeRetryPolicy';
import { applyTavernOutputRegexScripts } from './tavernRegexProcessor';
import {
  createDocumentVisibilitySource,
  createVisibilityBufferedPublisher,
  type VisibilityBufferedPublisher,
} from '@/utils/visibilityBufferedPublisher';
import { getAnticipatedNpcNamesForTurn, getCodexNpcNamesForTurn, getMissingPartyMembers } from './npcPresence';
import {
  buildRerollGenerationGuard,
  DEEPSEEK_MAIN_FORMAT_GUARD,
  requestMainNarrativeAttempt,
  runValidatedMainNarrativeRequest,
} from './mainNarrativeRequestStage';
import { createMainNarrativeStreamingSession, splitStreamingReveal } from './mainNarrativeStreamingSession';
import { pushWorkflowQueueTask as pushQueueTask } from './workflowQueue';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { 聊天消息 } from '@/models/chat';
import type { SendWorkflowDeps } from './sendWorkflow';
import type { MainPromptAssemblyResult } from './mainPromptAssembly';
import type { ApiMessagesResult } from './apiMessagesStage';
import { createRafCoalescedSetter } from '@/utils/rafCoalescedSetter';
import { createStreamingPreviewDelayController } from '@/utils/streamingPreviewDelay';
import { 创建聊天消息 } from '@/models/chat';
import { isPageHidden } from './sendWorkflow';
import type { API配置项 } from '@/models/settings';

export interface MainNarrativeStreamingStageDeps {
  state: UseGameStateReturn;
  abortController: AbortController;
  isCurrentWorkflow: () => boolean;
  deepSeekMainActive: boolean;
  systemPrompt: string;
  tavernV2Messages: 聊天消息[] | null;
  apiMessages: ApiMessagesResult['apiMessages'];
  currentPresetV2: MainPromptAssemblyResult['currentPresetV2'];
  rerollContext: SendWorkflowDeps['rerollContext'];
  streamMessageSetter: ReturnType<typeof createRafCoalescedSetter>;
  streamDelayController: ReturnType<typeof createStreamingPreviewDelayController>;
  mainStoryConfig: API配置项;
  shouldStreamMainRequest: ApiMessagesResult['shouldStreamMainRequest'];
  effectivePrefixMode: ApiMessagesResult['effectivePrefixMode'];
  effectivePrefixContent: ApiMessagesResult['effectivePrefixContent'];
  mainRequestMode: ApiMessagesResult['mainRequestMode'];
  visibilityPublisher: VisibilityBufferedPublisher | null;
  /** 在原始位置回写外层 visibilityPublisher。 */
  onVisibilityPublisherChanged: (publisher: VisibilityBufferedPublisher | null) => void;
}

export async function runMainNarrativeStreamingStage(deps: MainNarrativeStreamingStageDeps) {
  const {
    state,
    abortController,
    isCurrentWorkflow,
    deepSeekMainActive,
    systemPrompt,
    tavernV2Messages,
    apiMessages,
    currentPresetV2,
    streamMessageSetter,
    streamDelayController,
    mainStoryConfig,
    shouldStreamMainRequest,
    effectivePrefixMode,
    effectivePrefixContent,
    mainRequestMode,
  } = deps;
  let visibilityPublisher = deps.visibilityPublisher;

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

    if (abortController.signal.aborted || !isCurrentWorkflow()) return { earlyReturn: true as const, returnValue: undefined };

  return { earlyReturn: false as const,
    returnValue: undefined,
    streamingSession,
    result,
    deepSeekProtocolIssuesForTurn,
    rerollSimilarityForTurn,
    rerollSimilarityRetried,
  };
}
