/**
 * M6 拆分 · 阶段 3：准备发送给 API 的消息序列（原 executeSendWorkflow 内部步骤 3）。
 * 块的真实边界止于 mainRequestMode 之后 —— 后面的步骤 4 是流式请求，不属于本阶段。
 * 被搬动的代码逐字保留；systemPrompt 的写入在【原始位置】用回调回写外层，
 * 因为它在块之后仍被读取（步骤 4 的请求体与后续阶段都要用）。
 * 依赖类型从产出者推导（MainPromptAssemblyResult[...]），而非手工猜测。
 * 原 `sendWorkflow.ts:785-874`，共 90 行。
 *
 * 拆分原则：**纯搬运，不改行为** —— 被搬动的代码逐字保留（含原有换行与缩进）。
 */
import { buildNarrativeApiMessages, injectPromptModuleMessages } from './promptModuleMessageInjection';
import { buildRerollGenerationGuard, DEEPSEEK_MAIN_FORMAT_GUARD } from './mainNarrativeRequestStage';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { API配置项 } from '@/models/settings';
import type { 聊天消息 } from '@/models/chat';
import { 创建聊天消息 } from '@/models/chat';
import type { CodexEntry } from '@/models/teyvat/codex';
import type { MainPromptAssemblyResult } from './mainPromptAssembly';
import { getBuiltinPresets } from '@/data/builtinPresets';

export interface RunApiMessagesStageDeps {
  state: UseGameStateReturn;
  isOpeningSystemTrigger: boolean;
  isAwakeningEnterTrigger: boolean;
  openingInstruction: string;
  awakeningInstruction: string;
  awakeningPhase: MainPromptAssemblyResult['awakeningPhase'];
  mainStoryConfig: API配置项;
  tavernV2Messages: 聊天消息[] | null;
  codexPreview: MainPromptAssemblyResult['codexPreview'];
  recentHistory: MainPromptAssemblyResult['recentHistory'];
  moduleChatMessages: MainPromptAssemblyResult['moduleChatMessages'];
  rerollContext: { nonce: string; previousResponse: string } | null | undefined;
  buildTurnEnforcementBlock: (input: { playerName: string; wordCountTarget: number; codexEntries?: CodexEntry[]; storyWeavingActive: boolean }) => string;
  isDeepSeekMainConfig: (config: { provider?: string; baseUrl?: string; model?: string }) => boolean;
  isPageHidden: () => boolean;
  NARRATIVE_TURN_EXAMPLE_USER: string;
  NARRATIVE_TURN_EXAMPLE_ASSISTANT: string;
  systemPrompt: string;
  /** 在原始位置回写外层 systemPrompt。 */
  onSystemPromptUpdated: (prompt: string) => void;
}

export type ApiMessagesResult = Awaited<ReturnType<typeof runApiMessagesStage>>;

export async function runApiMessagesStage(deps: RunApiMessagesStageDeps) {
  const {
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
    rerollContext,
    buildTurnEnforcementBlock,
    isDeepSeekMainConfig,
    isPageHidden,
    NARRATIVE_TURN_EXAMPLE_USER,
    NARRATIVE_TURN_EXAMPLE_ASSISTANT,
  } = deps;
  let systemPrompt = deps.systemPrompt;

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
    // 注意：下面这行看起来是"死代码"（tsc --noUnusedLocals 会说它从未被读取），但它是
    // 被 scripts/deepseek-format-stability-regression.mjs:73 刻意钉住的**决定**：
    // 「正式主剧情不得使用预设 assistant prefill 截断 JSON」。删掉它会打红该回归门禁，
    // 因此必须保留（并保持字面形式 `const usePresetPrefill = false`）。
    const usePresetPrefill = false;
    const effectivePrefixMode = false;
    const effectivePrefixContent = '';

    if (deepSeekMainActive) {
      apiMessages.push(创建聊天消息('user', DEEPSEEK_MAIN_FORMAT_GUARD));
    }
    if (rerollContext && !isOpeningSystemTrigger) {
      apiMessages.push(创建聊天消息(
        'user',
        buildRerollGenerationGuard(rerollContext.nonce, rerollContext.previousResponse),
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
    deps.onSystemPromptUpdated(systemPrompt);
    apiMessages.length = 0;
    apiMessages.push(...promptModuleInjection.messages);

    const shouldStreamMainRequest = state.gameSettings.enableStreaming && !isPageHidden();
    const mainRequestMode: 'stream' | 'non-stream' = shouldStreamMainRequest ? 'stream' : 'non-stream';

  return {
    deepSeekMainMode,
    apiMessages,
    deepSeekMainActive,
    deepSeekLockFormat,
    effectivePrefixMode,
    effectivePrefixContent,
    shouldStreamMainRequest,
    mainRequestMode,
  };
}
