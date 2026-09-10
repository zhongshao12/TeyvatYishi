import type { 世界状态 } from '@/models/world';
import type { SteambirdNews } from '@/models/teyvat/steambird';
import type { 剧情编织系统 } from '@/models/storyWeaving';
import type { 记忆系统 } from '@/models/memory';

export type TimelineEventKind = "turn" | "steambird" | "plot" | "memory";

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  time: string;
  turn?: number;
  title: string;
  detail: string;
}

/** 合并当前时间、蒸汽鸟报、剧情编织时间线与长期记忆，按回合或时间字符串排序。 */
export function 构建时间线(
  world: 世界状态,
  steambird: SteambirdNews,
  storyWeaving: 剧情编织系统,
  memory: 记忆系统,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let counter = 0;
  const nextId = (kind: TimelineEventKind) => `tl_${kind}_${counter++}`;

  for (const article of steambird.articles) {
    events.push({ id: nextId("steambird"), kind: "steambird", time: article.body ? article.title : "", turn: article.turn, title: article.title, detail: article.body });
  }
  for (const series of storyWeaving?.系列列表 ?? []) {
    for (const segment of series.分段列表 ?? []) {
      for (const event of segment.时间线 ?? []) {
        events.push({ id: nextId("plot"), kind: "plot", time: event.时间锚点 || "", turn: segment.组号, title: event.标题, detail: event.描述 || "" });
      }
    }
  }
  for (const item of memory?.长期记忆 ?? []) {
    events.push({ id: nextId("memory"), kind: "memory", time: "", title: "长期记忆", detail: item });
  }
  events.push({ id: nextId("turn"), kind: "turn", time: "", title: "当前时间", detail: `${world?.当前日期 || ""} ${world?.当前时间 || ""} · ${world?.当前地点 || "未知地点"}` });

  return events.sort((a, b) => {
    const at = a.turn ?? Number.MAX_SAFE_INTEGER;
    const bt = b.turn ?? Number.MAX_SAFE_INTEGER;
    if (at !== bt) return at - bt;
    return a.time.localeCompare(b.time);
  });
}
