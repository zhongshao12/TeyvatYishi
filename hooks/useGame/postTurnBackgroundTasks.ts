import type { SteambirdNews } from '@/models/teyvat/steambird';
import { executeSteambirdTaskForSession, type SteambirdTaskInput } from './postTurnSteambirdTask';
import type { WorldMoment } from '@/models/teyvat/worldMoment';

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
  worldMoment?: WorldMoment;
  task?: SteambirdTaskInput;
  owner?: Parameters<typeof executeSteambirdTaskForSession>[1];
}

export interface SteambirdPostTurnTaskResult {
  news: SteambirdNews;
  status: 'skipped' | 'success' | 'failed';
  changed: boolean;
  detail: string;
  pendingDetail?: string;
}

export async function runSteambirdPostTurnTask(
  input: SteambirdPostTurnTaskInput,
): Promise<SteambirdPostTurnTaskResult> {
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

  if (!input.task) return { news: input.current, status: 'skipped', changed: false, detail: '没有已确认公开的事实载荷，未投递正文或玩家输入。' };
  let news = input.current;
  const owner = input.owner ?? { read: () => news, update: (updater: (current: SteambirdNews) => SteambirdNews) => { news = updater(news); }, isCurrent: () => true };
  const generation = await executeSteambirdTaskForSession(input.task, owner);
  news = owner.read();
  return {
    news,
    status: generation.status,
    changed: generation.articles.length > 0,
    pendingDetail: input.openingTurn
      ? '开局首回合正在先处理一次蒸汽鸟报。'
      : `正在调用蒸汽鸟报独立 API（只读取已确认公开事实）。`,
    detail: generation.status === 'success'
      ? `蒸汽鸟报已更新，当前共 ${news.articles.length} 篇报道。`
      : generation.reason ?? '蒸汽鸟报未生成有效结果。',
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
