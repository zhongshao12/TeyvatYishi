/**
 * M6 拆分 · 阶段 7：世界事实/元素回响/天气结算 + 本回合请求态复位（原 executeSendWorkflow 内部步骤 7 / 7a / 7b）。
 * 块的真实边界止于 tavernV2Messages = null —— 后面的步骤 8.5 是变量模型校准，不属于本阶段。
 * 被搬动的代码逐字保留（含原有换行与缩进）。
 * 四个外层可变量在【原始位置】用回调回写：
 *   - result / apiMessages 在外层是 const（对象/数组），块内只改属性/长度 -> mode=mutate，调用方不再赋值；
 *   - systemPrompt / tavernV2Messages 在外层是 let -> mode=assign，按值回写。
 *   块后紧跟着 await（步骤 8.5），一旦抛错，调用方的 catch/finally 会看到这些写入，所以不能改成「返回后统一赋值」。
 * worldAfter / travelerAfter 在外层是 let（步骤 8.5 之后按需重赋），调用方必须用 let 承接。
 * 依赖类型从产出者推导，而非手工猜测。
 * 原 `sendWorkflow.ts:1007-1025`，共 19 行。
 *
 * 拆分原则：**纯搬运，不改行为** —— 被搬动的代码逐字保留（含原有换行与缩进）。
 */
import { createEmptyNarrativeTurn, type NarrativeTurn } from '@/models/teyvat/narrativeTurn';
import { applyNarrativeWorldStage } from './narrativeWorldStage';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { 聊天消息 } from '@/models/chat';
import type { MainNarrativeRequestStageResult } from './mainNarrativeRequestStage';
import { buildNarrativeApiMessages } from './promptModuleMessageInjection';
import { createMainNarrativeStreamingSession } from './mainNarrativeStreamingSession';

export interface RunWorldCommitStageDeps {
  state: UseGameStateReturn;
  effectiveWorld: UseGameStateReturn['世界'];
  parsedForDisplay: NarrativeTurn;
  displayText: string;
  result: MainNarrativeRequestStageResult['result'];
  apiMessages: ReturnType<typeof buildNarrativeApiMessages>;
  streamingSession: ReturnType<typeof createMainNarrativeStreamingSession>;
  systemPrompt: string;
  tavernV2Messages: 聊天消息[] | null;
  /** 在原始位置回写外层 result。 */
  onResultMutated: (current: MainNarrativeRequestStageResult['result']) => void;
  /** 在原始位置回写外层 apiMessages。 */
  onApiMessagesCleared: (messages: ReturnType<typeof buildNarrativeApiMessages>) => void;
  /** 在原始位置回写外层 systemPrompt。 */
  onSystemPromptUpdated: (prompt: string) => void;
  /** 在原始位置回写外层 tavernV2Messages。 */
  onTavernV2MessagesUpdated: (messages: 聊天消息[] | null) => void;
}

export async function runWorldCommitStage(deps: RunWorldCommitStageDeps) {
  const {
    state,
    effectiveWorld,
    parsedForDisplay,
    displayText,
    result,
    apiMessages,
    streamingSession,
  } = deps;
  let systemPrompt = deps.systemPrompt;
  let tavernV2Messages = deps.tavernV2Messages;

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
    deps.onResultMutated(result);
    result.parsed = createEmptyNarrativeTurn();
    deps.onResultMutated(result);
    result.usage = undefined;
    deps.onResultMutated(result);
    apiMessages.length = 0;
    deps.onApiMessagesCleared(apiMessages);
    systemPrompt = '';
    deps.onSystemPromptUpdated(systemPrompt);
    streamingSession.reset();
    tavernV2Messages = null;
    deps.onTavernV2MessagesUpdated(tavernV2Messages);

  return {
    worldFactCandidates,
    worldAfter,
    travelerAfter,
  };
}
