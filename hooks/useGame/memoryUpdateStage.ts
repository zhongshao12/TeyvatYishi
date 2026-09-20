/**
 * M6 拆分 · 阶段 6：写入即时记忆并检查压缩阈值（原 executeSendWorkflow 内部步骤 6）。
 * 块的真实边界止于 pushQueueTask 的反馈队列任务 —— 后面的步骤 7 是世界事实/元素回响/天气结算，不属于本阶段。
 * 被搬动的代码逐字保留（含原有换行与缩进）。
 * 本阶段不写入任何外层可变量；需交回调用方的是 mem 与 irminsulWithCompression。
 * 注意：mem 在外层是 let（步骤 8.5 之后会被重新赋值），所以调用方必须用 let 解构，不能用 const。
 * 依赖类型从产出者推导，而非手工猜测。
 * 原 `sendWorkflow.ts:993-1013`，共 21 行。
 *
 * 拆分原则：**纯搬运，不改行为** —— 被搬动的代码逐字保留（含原有换行与缩进）。
 */
import { pushWorkflowQueueTask as pushQueueTask } from './workflowQueue';
import { settlePostNarrativeMemory } from './postNarrativeMemoryStage';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { API配置项 } from '@/models/settings';
import type { NarrativeTurn } from '@/models/teyvat/narrativeTurn';
import { 创建默认记忆系统设置 } from '@/models/settings';

export interface RunMemoryUpdateStageDeps {
  state: UseGameStateReturn;
  userInput: string;
  config: API配置项;
  displayText: string;
  parsedForDisplay: NarrativeTurn;
  abortController: AbortController;
  assertWorkflowActive: () => void;
}

export async function runMemoryUpdateStage(deps: RunMemoryUpdateStageDeps) {
  const {
    state,
    userInput,
    config,
    displayText,
    parsedForDisplay,
    abortController,
    assertWorkflowActive,
  } = deps;

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

  return {
    mem,
    irminsulWithCompression,
  };
}
