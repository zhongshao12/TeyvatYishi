import { useMemo, useState } from 'react';
import type { 世界状态 } from '@/models/world';
import type { SteambirdNews } from '@/models/teyvat/steambird';
import type { 剧情编织系统 } from '@/models/storyWeaving';
import type { 记忆系统 } from '@/models/memory';
import { 构建时间线, type TimelineEventKind } from '@/utils/timelineBuilder';

interface TimelinePanelProps {
  world: 世界状态;
  steambird: SteambirdNews;
  storyWeaving: 剧情编织系统;
  memory: 记忆系统;
}

const cardClip = 'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)';
const smallClip = 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)';

const KIND_LABELS: Record<TimelineEventKind, string> = {
  turn: "时间", steambird: "蒸汽鸟报", plot: "剧情", memory: "记忆",
} as const;

export function TimelinePanel({ world, steambird, storyWeaving, memory }: TimelinePanelProps) {
  const [filter, setFilter] = useState<TimelineEventKind | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const events = useMemo(() => 构建时间线(world, steambird, storyWeaving, memory), [world, steambird, storyWeaving, memory]);
  const visible = filter === "all" ? events : events.filter((event) => event.kind === filter);
  const kinds: Array<{ key: TimelineEventKind | "all"; label: string }> = [
    { key: "all", label: "全部" },
    { key: "steambird", label: "蒸汽鸟报" },
    { key: "plot", label: "剧情" },
    { key: "memory", label: "记忆" },
  ];
  const kindColor: Record<TimelineEventKind, string> = {
    turn: "rgba(var(--tj-text-secondary),0.7)",
    steambird: "rgba(var(--tj-arcane-accent),0.9)",
    plot: "rgba(var(--tj-accent-primary),0.9)",
    memory: "rgba(var(--tj-ui-success),0.85)",
  };
  return (
    <div className="space-y-4">
      <div className="px-4 py-3" style={{ background: "rgba(var(--tj-accent-primary),0.045)", boxShadow: "inset 0 0 0 1px rgba(var(--tj-accent-primary),0.16)", clipPath: cardClip }}>
        <div className="font-serif text-xs tracking-[0.28em]" style={{ color: "rgba(var(--tj-accent-primary),0.78)" }}>◆ 事件时间线</div>
        <div className="mt-1 text-[11px]" style={{ color: "rgba(var(--tj-text-secondary),0.7)" }}>回合 → 蒸汽鸟报 → 剧情编织事件 → 长期记忆，按时间排序。</div>
      </div>
      <div className="flex flex-wrap gap-1 p-1" style={{ background: "rgba(var(--tj-bg-primary),0.58)", boxShadow: "inset 0 0 0 1px rgba(var(--tj-accent-primary),0.14)", clipPath: smallClip }}>
        {kinds.map((item) => {
          const active = filter === item.key;
          return (
            <button key={item.key} type="button" onClick={() => setFilter(item.key)} className="px-3 py-1.5 text-[12px]" style={{
              color: active ? "rgb(var(--tj-text-primary))" : "rgba(var(--tj-text-secondary),0.75)",
              background: active ? "rgba(var(--tj-accent-primary),0.14)" : "transparent",
              boxShadow: active ? "inset 0 0 0 1px rgba(var(--tj-accent-primary),0.32)" : "none",
              clipPath: smallClip,
            }}>{item.label}</button>
          );
        })}
      </div>
      <div className="space-y-2">
        {visible.length === 0 ? (
          <div className="px-4 py-12 text-center font-serif text-xs italic tracking-[0.2em]" style={{ color: "rgba(var(--tj-text-secondary),0.6)", boxShadow: "inset 0 0 0 1px rgba(var(--tj-accent-primary),0.12)", clipPath: cardClip }}>暂无时间线事件。</div>
        ) : visible.map((event) => (
          <button key={event.id} type="button" onClick={() => setExpandedId(expandedId === event.id ? null : event.id)} className="block w-full px-4 py-3 text-left" style={{ background: "rgba(var(--tj-bg-primary),0.5)", boxShadow: `inset 0 0 0 1px ${kindColor[event.kind]}`, clipPath: cardClip }}>
            <div className="flex items-center gap-2 text-[11px]" style={{ color: "rgba(var(--tj-text-secondary),0.7)" }}>
              <span style={{ color: kindColor[event.kind] }}>{KIND_LABELS[event.kind]}</span>
              {event.turn ? <span>· 第 {event.turn} 回合</span> : null}
              {event.time ? <span>· {event.time}</span> : null}
            </div>
            <div className="mt-1 text-sm font-semibold" style={{ color: "rgb(var(--tj-text-primary))" }}>{event.title}</div>
            {expandedId === event.id && event.detail ? <div className="mt-2 text-xs leading-relaxed" style={{ color: "rgba(var(--tj-text-secondary),0.85)" }}>{event.detail}</div> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
