/**
 * M6 拆分 · 阶段 1：本回合前置快照 + 用户消息入历史
 * （原 `executeSendWorkflow` 内部步骤 0-1，原 `sendWorkflow.ts:722-761`）。
 *
 * 拆分原则：**纯搬运，不改行为**。因此本模块刻意做了两件事：
 *
 *  1. 代码顺序与 `await` 时机与原实现逐点一致；
 *  2. 原先直接写入外层三个 `let` 可变量
 *     （`rollbackSnapshotOnAbort` / `rollbackHistoryOnAbort` / `recoveryJournal`）
 *     改为**回调在原始位置回写**，而不是「函数返回后由调用方统一赋值」。
 *
 *     原因不是风格，是行为等价性：原实现里 `rollbackSnapshotOnAbort` 在
 *     `await persistWorkflowRecoveryJournal(...)` **之前**就被赋值。若改成返回后统一赋值，
 *     那么当 recovery journal 落库失败（IndexedDB 异常）时，异常路径上这些变量会是拆分前的旧值，
 *     而 `sendWorkflow.ts:1962-1968` 的回滚逻辑会读到它们 —— 属于真实的行为变更。
 *     用回调即可在异常路径上逐点保持一致。
 */
import { 创建聊天消息, type 聊天消息, type 回合快照 } from '@/models/chat';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import { compactPreTurnSnapshot } from '@/utils/saveRuntimeCompactor';
import { compactChatHistoryForLongSession } from '@/utils/longSessionRetention';
import {
  persistWorkflowRecoveryJournal,
  updateWorkflowRecoveryJournal,
  type WorkflowRecoveryJournal,
} from '@/services/workflowRecovery';

export interface SendPreparationInput {
  userInput: string;
  state: UseGameStateReturn;
  effectiveWorld: UseGameStateReturn['世界'];
  recoveryJournal: WorkflowRecoveryJournal;
  /** 在原始位置回写外层 `rollbackSnapshotOnAbort`。 */
  onSnapshotReady: (snapshot: 回合快照) => void;
  /** 在原始位置回写外层 `recoveryJournal`（journal 更新之后、落库之前）。 */
  onJournalUpdated: (journal: WorkflowRecoveryJournal) => void;
  /** 在原始位置回写外层 `rollbackHistoryOnAbort`。 */
  onPurgedHistoryReady: (history: 聊天消息[]) => void;
}

export interface SendPreparationResult {
  preTurnSnapshot: 回合快照;
  userMsg: 聊天消息;
  updatedHistory: 聊天消息[];
  recoveryJournal: WorkflowRecoveryJournal;
}

export async function prepareSendTurn(input: SendPreparationInput): Promise<SendPreparationResult> {
  const { state, userInput, effectiveWorld } = input;
  let recoveryJournal = input.recoveryJournal;

  // 0. 本回合 user 发送之前的全状态快照，留给 reroll 回滚用。
  //    避免重 roll 时上次的变量副作用堆叠（NPC / 蒸汽鸟报等都会双份）。
  const preTurnSnapshot = compactPreTurnSnapshot({
    旅人: state.旅人,
    背包: state.背包,
    世界: effectiveWorld,
    记忆: state.记忆,
    世界树: state.世界树,
    图鉴: state.图鉴,
    手机: state.手机,
    NPC: state.NPC,
    相册: state.相册,
    蒸汽鸟报: state.蒸汽鸟报,
    剧情: state.剧情,
    剧情编织: state.剧情编织,
    任务: state.任务,
    // 地图只存在于 Teyvat 根上（legacy hook state 没有该切片）。
    地图: state.game.地图,
    variableBatches: state.variableBatches,
    queueTasks: state.queueTasks,
    turnCount: state.turnCount,
    pendingOpeningTrigger: state.pendingOpeningTrigger,
  });
  input.onSnapshotReady(preTurnSnapshot);

  // 1. Add user message。同时把过往 assistant 上的 snapshot 全部清掉，只保留即将生成的最新一条，
  //    避免存档无限膨胀（snapshot 只服务"最近一次 reroll"，老的没用）。
  //    同时把 preTurnSnapshot 也挂到 user 消息上，这样主剧情生成失败（没有 assistant 消息）时，
  //    重roll 仍能找到快照回滚，不会误回退到上一回合。
  const userMsg = 创建聊天消息('user', userInput, {
    gameTime: `${state.turnCount}`,
    preTurnSnapshot,
  });
  recoveryJournal = updateWorkflowRecoveryJournal(recoveryJournal, { userMessageId: userMsg.id });
  input.onJournalUpdated(recoveryJournal);
  await persistWorkflowRecoveryJournal(recoveryJournal);
  const purgedHistory = compactChatHistoryForLongSession(state.chatHistory.map((m) =>
    m.role === 'assistant' && m.preTurnSnapshot
      ? { ...m, preTurnSnapshot: undefined }
      : m,
  ));
  input.onPurgedHistoryReady(purgedHistory);
  const updatedHistory = [...purgedHistory, userMsg];
  state.setChatHistory(updatedHistory);

  return { preTurnSnapshot, userMsg, updatedHistory, recoveryJournal };
}
