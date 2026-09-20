import type { 图片生成任务 } from '@/models/imageGeneration';

export interface ImageQueueOptions {
  /** 同时执行的生成任务数，默认 1（串行）。 */
  concurrency: number;
  /** 任务失败后的最大重试次数（不含首次执行）。 */
  maxRetries: number;
}

export interface ImageQueueResult<T = unknown> {
  status: 'success' | 'failed';
  error?: string;
  /** 成功时返回执行器的真实结果。 */
  value?: T;
}

interface PendingRun<T> {
  id: string;
  attempts: number;
  executor: (signal: AbortSignal) => Promise<T>;
  resolve: (result: ImageQueueResult<T>) => void;
}

/** 超过该时长的 running 任务视为崩溃残留，启动时标记为失败。 */
export const STALE_RUNNING_MS = 10 * 60 * 1000;

export function recoverStaleTasks(tasks: 图片生成任务[], now = Date.now()): 图片生成任务[] {
  return tasks.map((task) => {
    if (task.status !== 'running') return task;
    const startedAt = task.startedAt ?? now;
    if (now - startedAt <= STALE_RUNNING_MS) return task;
    return { ...task, status: 'failed' as const, error: '任务被中断（应用重启），可手动重试。' };
  });
}

/**
 * 立即恢复“没有实际 worker”的 running 任务：页面重启后队列单例已重建，
 * 任何不在 liveRunningIds 中的 running 任务都不可能有执行中的请求。
 */
export function recoverInterruptedTasks(
  tasks: 图片生成任务[],
  liveRunningIds: ReadonlySet<string> | Iterable<string>,
): 图片生成任务[] {
  const live = liveRunningIds instanceof Set ? liveRunningIds : new Set(liveRunningIds);
  return tasks.map((task) => {
    if (task.status !== 'running' || live.has(task.id)) return task;
    return { ...task, status: 'failed' as const, error: '任务被中断（应用重启），可手动重试。' };
  });
}

export function createImageTaskQueue(options: ImageQueueOptions) {
  let currentOptions = { ...options };
  const queue: PendingRun<unknown>[] = [];
  const running = new Map<string, AbortController>();
  let activeCount = 0;

  function pump(): void {
    while (activeCount < currentOptions.concurrency && queue.length > 0) {
      const run = queue.shift();
      if (!run) break;
      activeCount += 1;
      const controller = new AbortController();
      running.set(run.id, controller);
      void execute(run, controller);
    }
  }

  async function execute(run: PendingRun<unknown>, controller: AbortController): Promise<void> {
    try {
      const value = await run.executor(controller.signal);
      if (controller.signal.aborted) {
        // executor 忽略取消信号仍正常返回时，队列必须再次检查取消状态，避免 cancelled 被 success 覆盖。
        run.resolve({ status: 'failed', error: '任务已取消。' });
        return;
      }
      run.resolve({ status: 'success', value });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted = controller.signal.aborted;
      if (aborted || run.attempts >= currentOptions.maxRetries) {
        run.resolve({ status: 'failed', error: aborted ? '任务已取消。' : message });
      } else {
        run.attempts += 1;
        queue.push(run);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * run.attempts));
      }
    } finally {
      if (running.get(run.id) === controller) running.delete(run.id);
      activeCount -= 1;
      pump();
    }
  }

  return {
    /** 包装一个异步执行器，返回按 taskId 入队并返回最终结果的函数。 */
    createRunner<T>(executor: (taskId: string, signal: AbortSignal) => Promise<T>) {
      return (taskId: string): Promise<ImageQueueResult<T>> =>
        new Promise((resolve) => {
          queue.push({
            id: taskId,
            attempts: 0,
            executor: (signal) => executor(taskId, signal),
            resolve: (result) => resolve(result as ImageQueueResult<T>),
          });
          pump();
        });
    },
    /** 取消正在运行的任务（AbortController.abort）。 */
    cancel(taskId: string) {
      const runningController = running.get(taskId);
      if (runningController) {
        runningController.abort();
        return;
      }
      const index = queue.findIndex((run) => run.id === taskId);
      if (index >= 0) {
        const removed = queue.splice(index, 1)[0];
        removed?.resolve({ status: 'failed', error: '任务已取消。' });
      }
    },
    /** 运行时调整并发数（对新入队任务生效）。 */
    setConcurrency(concurrency: number) {
      const next = Math.max(1, Math.trunc(concurrency) || 1);
      currentOptions = { ...currentOptions, concurrency: next };
      pump();
    },
    /** 当前正在执行的任务 id（供崩溃恢复判断“是否还有实际 worker”）。 */
    runningIds(): string[] {
      return Array.from(running.keys());
    },
    get size() {
      return queue.length;
    },
  };
}

/** 全局共享生图队列：相册手动生图与回合自动快照共用，默认串行。 */
export const globalImageTaskQueue = createImageTaskQueue({ concurrency: 1, maxRetries: 0 });
