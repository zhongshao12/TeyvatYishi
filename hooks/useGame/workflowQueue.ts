import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { 队列任务ID, 队列任务记录, 队列任务状态 } from '@/models/queueTask';

const TITLE_BY_ID: Record<队列任务ID, string> = {
  main_story: '主剧情生成',
  memory: '记忆整理',
  variable: '变量生成',
  steambird: '蒸汽鸟报',
  world_evolution: '世界演变',
  irminsul: '世界树召回',
  codex: '图鉴检索',
  courier: '手机消息',
  autosave: '自动存档',
  narrative_image_parse: '故事快照解析',
  narrative_image_generate: '故事快照生成',
  quest: '剧情任务',
};

const SUBTITLE_BY_ID: Record<队列任务ID, string> = {
  main_story: '主 API 输出正文与行动选项',
  memory: '即时记忆写入与自动压缩',
  variable: '解析正文并落地变量命令',
  steambird: '独立 API 推演蒸汽鸟报与后台事件',
  world_evolution: '后续接入独立世界演变 API',
  narrative_image_parse: '从正文提取故事快照提示词',
  narrative_image_generate: '调用生图 API 生成故事快照',
  quest: '解析任务更新并结算目标进度',
  irminsul: '后续接入回忆检索队列',
  codex: '独立 API 检索原著资料',
  courier: '主动消息契机与手机入口',
  autosave: '写入最近自动存档',
};

export interface WorkflowQueueTaskPatch {
  title?: string;
  subtitle?: string;
  detail?: string;
  rawText?: string;
  turn?: number;
  targetMessageId?: string;
  targetBatchId?: string;
  retryHint?: string;
  failCount?: number;
  retrying?: boolean;
  cancellable?: boolean;
  cancelled?: boolean;
}

/** 一个回合共用中止信号；停止时不能把结果伪装成仅取消了被点击的任务。 */
export function cancelPendingWorkflowTasks(tasks: 队列任务记录[], turn: number): 队列任务记录[] {
  const latestIndexById = new Map<队列任务ID, number>();
  tasks.forEach((task, index) => {
    if (task.turn === turn) latestIndexById.set(task.id, index);
  });
  return tasks.map((task, index) => task.turn === turn && latestIndexById.get(task.id) === index && task.status === 'pending'
    ? {
        ...task,
        status: 'cancelled' as const,
        cancelled: true,
        cancellable: false,
        detail: '玩家已停止本回合，进行中的任务随回合中止。',
      }
    : task);
}

export function pushWorkflowQueueTask(
  state: UseGameStateReturn,
  id: 队列任务ID,
  status: 队列任务状态,
  patch?: WorkflowQueueTaskPatch,
): 队列任务记录 {
  const record: 队列任务记录 = {
    id,
    title: patch?.title ?? TITLE_BY_ID[id],
    subtitle: patch?.subtitle ?? SUBTITLE_BY_ID[id],
    turn: patch?.turn ?? state.turnCount,
    timestamp: Date.now(),
    status,
    detail: patch?.detail,
    rawText: patch?.rawText,
    targetMessageId: patch?.targetMessageId,
    targetBatchId: patch?.targetBatchId,
    retryHint: patch?.retryHint,
    failCount: patch?.failCount,
    retrying: patch?.retrying,
    cancellable: patch?.cancellable,
    cancelled: patch?.cancelled,
  };
  state.setQueueTasks((previous) => [...previous.slice(-24), record]);
  return record;
}
