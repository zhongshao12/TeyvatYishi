import type { SteambirdNews } from '@/models/teyvat/steambird';
import { runSteambirdGenerationStep } from './steambirdWorkflow';

export type PostTurnBackgroundMode = 'sequential' | 'parallel';

export interface PostTurnBackgroundJobs {
  mode: PostTurnBackgroundMode;
  steambird: () => Promise<void>;
  irminsul: () => Promise<void>;
  courierDelivery: () => Promise<void>;
  courierReply: () => Promise<void>;
  narrativeImage: () => Promise<void>;
}

export interface SteambirdPostTurnTaskInput {
  enabled: boolean;
  shouldRun: boolean;
  openingTurn: boolean;
  interval: number;
  current: SteambirdNews;
  turn: number;
  userInput: string;
  body: string;
  now?: number;
}

export interface SteambirdPostTurnTaskResult {
  news: SteambirdNews;
  status: 'skipped' | 'success';
  changed: boolean;
  detail: string;
  pendingDetail?: string;
}

export function runSteambirdPostTurnTask(
  input: SteambirdPostTurnTaskInput,
): SteambirdPostTurnTaskResult {
  if (!input.enabled) {
    return { news: input.current, status: 'skipped', changed: false, detail: '蒸汽鸟报未开启，已跳过。' };
  }
  if (!input.shouldRun) {
    return {
      news: input.current,
      status: 'skipped',
      changed: false,
      detail: `未到蒸汽鸟报触发间隔（每 ${input.interval} 回合一次），已跳过。`,
    };
  }

  const generation = runSteambirdGenerationStep({
    current: input.current,
    publicFacts: [{ title: `第 ${input.turn} 回公开见闻`, detail: `${input.userInput}\n${input.body}`.trim() }],
    turnCount: input.turn,
    now: input.now,
  });
  const news = generation?.steambird ?? input.current;
  return {
    news,
    status: 'success',
    changed: generation?.changed === true,
    pendingDetail: input.openingTurn
      ? '开局首回合正在先处理一次蒸汽鸟报。'
      : `正在调用蒸汽鸟报独立 API（读取最近 ${input.interval} 回合）。`,
    detail: generation?.changed
      ? `蒸汽鸟报已更新，当前共 ${news.articles.length} 篇报道。`
      : generation
        ? '蒸汽鸟报本回合没有可写报道变化。'
        : '蒸汽鸟报未生成有效结果。',
  };
}

export async function runPostTurnBackgroundTasks(jobs: PostTurnBackgroundJobs): Promise<void> {
  const runCourierPipeline = async () => {
    await jobs.courierDelivery();
    await jobs.courierReply();
  };

  if (jobs.mode === 'parallel') {
    await Promise.all([
      jobs.steambird(),
      jobs.irminsul(),
      runCourierPipeline(),
      jobs.narrativeImage(),
    ]);
    return;
  }

  await jobs.steambird();
  await jobs.irminsul();
  await runCourierPipeline();
  await jobs.narrativeImage();
}
