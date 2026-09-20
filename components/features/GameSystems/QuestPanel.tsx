import { CLIP_CARD, CLIP_SMALL, insetRing } from '@/styles/clipPaths';
import { useMemo, useState } from 'react';
import type { QuestEntry, QuestJournal } from '@/models/teyvat';
import { abandonQuest } from '@/services/questService';

interface QuestPanelProps {
  quest: QuestJournal;
  onQuestChange: (updater: (previous: QuestJournal) => QuestJournal) => void;
}

type QuestTab = 'active' | 'done' | 'abandoned';




function QuestCard({ task, onAbandon }: { task: QuestEntry; onAbandon?: () => void }) {
  const doneCount = task.objectives.filter((item) => item.completed).length;
  const progress = task.objectives.length > 0 ? Math.round((doneCount / task.objectives.length) * 100) : 0;
  return (
    <article className="overflow-hidden px-4 py-4" style={{ background: "rgba(var(--tj-ui-panel),0.42)", boxShadow: insetRing(0.16), clipPath: CLIP_CARD }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-serif text-sm font-bold tracking-[0.1em]" style={{ color: "rgb(var(--tj-accent-primary))" }}>{task.title}</span>
            <span className="px-1.5 py-0.5 text-[10px]" style={{ color: "rgba(var(--tj-text-secondary),0.75)", boxShadow: "inset 0 0 0 1px rgba(var(--tj-border),0.5)", clipPath: CLIP_SMALL }}>{QUEST_SOURCE_LABELS[task.source]}</span>
          </div>
          {task.description && <div className="mt-1.5 text-xs leading-relaxed" style={{ color: "rgba(var(--tj-text-secondary),0.82)" }}>{task.description}</div>}
        </div>
        {onAbandon && (
          <button type="button" onClick={onAbandon} className="shrink-0 px-2 py-1 text-[11px]" style={{ color: "rgba(var(--tj-danger),0.92)", boxShadow: "inset 0 0 0 1px rgba(var(--tj-danger),0.3)", clipPath: CLIP_SMALL }}>放弃</button>
        )}
      </div>
      {task.objectives.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {task.objectives.map((target) => (
            <div key={target.id} className="flex items-center gap-2 text-xs" style={{ color: target.completed ? "rgba(var(--tj-ui-success),0.95)" : "rgba(var(--tj-text-secondary),0.86)" }}>
              <span>{target.completed ? "✔" : "○"}</span>
              <span className="min-w-0 flex-1">{target.description}</span>
              <span className="shrink-0 opacity-75">{target.completed ? "已完成" : `${target.currentCount}/${target.targetCount}`}</span>
            </div>
          ))}
        </div>
      )}
      {task.rewards.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          {task.rewards.map((reward, index) => (
            <span key={index} className="px-1.5 py-0.5" style={{ color: "rgba(var(--tj-accent-secondary),0.9)", background: "rgba(var(--tj-accent-secondary),0.08)", clipPath: CLIP_SMALL }}>
              {reward}
            </span>
          ))}
        </div>
      )}
      {task.objectives.length > 0 && (
        <div className="mt-3 h-1 overflow-hidden bg-[rgba(var(--tj-text-secondary),0.12)]">
          <div className="h-full transition-[width] duration-200" style={{ width: `${progress}%`, background: "rgb(var(--tj-accent-primary))" }} />
        </div>
      )}
    </article>
  );
}

const QUEST_SOURCE_LABELS: Record<QuestEntry['source'], string> = {
  main: '魔神任务',
  side: '传说任务',
  custom: '自己接取的任务',
  letter: '手机委托',
};
const QUEST_SOURCE_ORDER: QuestEntry['source'][] = ['main', 'side', 'letter', 'custom'];

export function QuestPanel({ quest, onQuestChange }: QuestPanelProps) {
  const [tab, setTab] = useState<QuestTab>('active');
  const [sourceFilter, setSourceFilter] = useState<'all' | QuestEntry['source']>('all');
  const lists = useMemo(() => ({
    active: quest.active ?? [],
    done: quest.completed ?? [],
    abandoned: quest.abandoned ?? [],
  }), [quest]);
  const tabs: Array<{ id: QuestTab; label: string; count: number }> = [
    { id: "active", label: "进行中", count: lists.active.length },
    { id: "done", label: "已完成", count: lists.done.length },
    { id: "abandoned", label: "已放弃", count: lists.abandoned.length },
  ];
  const visible = useMemo(
    () => (sourceFilter === 'all' ? lists[tab] : lists[tab].filter((task) => task.source === sourceFilter)),
    [lists, tab, sourceFilter],
  );
  return (
    <div className="space-y-4">
      <div className="px-4 py-3" style={{ background: "rgba(var(--tj-accent-primary),0.05)", boxShadow: insetRing(0.18), clipPath: CLIP_CARD }}>
        <div className="font-serif text-xs tracking-[0.28em]" style={{ color: "rgba(var(--tj-accent-primary),0.78)" }}>◆ 剧情任务</div>
        <div className="mt-1 text-[11px]" style={{ color: "rgba(var(--tj-text-secondary),0.7)" }}>任务目标由系统按正文与变量自动结算；AI 通过任务更新协议创建或推进任务。</div>
      </div>
      <div className="flex gap-1 p-1" style={{ background: "rgba(var(--tj-bg-primary),0.58)", boxShadow: insetRing(0.14), clipPath: CLIP_SMALL }}>
        {tabs.map((item) => {
          const active = tab === item.id;
          return (
            <button key={item.id} type="button" onClick={() => setTab(item.id)} className="flex-1 px-3 py-1.5 text-[12px]" style={{
              color: active ? "rgb(var(--tj-text-primary))" : "rgba(var(--tj-text-secondary),0.75)",
              background: active ? "rgba(var(--tj-accent-primary),0.14)" : "transparent",
              boxShadow: active ? insetRing(0.32) : "none",
              clipPath: CLIP_SMALL,
            }}>
              {item.label} <span style={{ color: active ? "rgb(var(--tj-accent-primary))" : "rgba(var(--tj-arcane-accent),0.66)" }}>{item.count}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={() => setSourceFilter('all')} className="px-2 py-1 text-[11px]" style={{
          color: sourceFilter === 'all' ? 'rgb(var(--tj-text-primary))' : 'rgba(var(--tj-text-secondary),0.75)',
          background: sourceFilter === 'all' ? 'rgba(var(--tj-accent-primary),0.14)' : 'transparent',
          boxShadow: sourceFilter === 'all' ? insetRing(0.32) : 'none',
          clipPath: CLIP_SMALL,
        }}>全部来源</button>
        {QUEST_SOURCE_ORDER.map((s) => (
          <button key={s} type="button" onClick={() => setSourceFilter(s)} className="px-2 py-1 text-[11px]" style={{
            color: sourceFilter === s ? 'rgb(var(--tj-text-primary))' : 'rgba(var(--tj-text-secondary),0.75)',
            background: sourceFilter === s ? 'rgba(var(--tj-accent-primary),0.14)' : 'transparent',
            boxShadow: sourceFilter === s ? insetRing(0.32) : 'none',
            clipPath: CLIP_SMALL,
          }}>{QUEST_SOURCE_LABELS[s]}</button>
        ))}
      </div>
      {visible.length === 0 ? (
        <div className="px-4 py-12 text-center font-serif text-xs italic tracking-[0.2em]" style={{ color: "rgba(var(--tj-text-secondary),0.6)", boxShadow: insetRing(0.12), clipPath: CLIP_CARD }}>
          {tab === "active" ? "当前没有进行中的任务。" : tab === "done" ? "还没有已完成的任务。" : "还没有已放弃的任务。"}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visible.map((task) => (
            <QuestCard
              key={task.id}
              task={task}
              onAbandon={tab === "active" ? () => onQuestChange((previous) => abandonQuest(previous, task.id)) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
