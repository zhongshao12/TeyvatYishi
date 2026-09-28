import { CLIP_ITEM, insetRing } from '@/styles/clipPaths';
import { useMemo, useState } from 'react';
import type { IrminsulMemory, IrminsulEntry } from '@/models/teyvat/irminsul';
import { getActiveIrminsulEntries } from '@/services/irminsulPromotion';

const ARCHIVE_TYPE_LABELS: Record<IrminsulEntry['archiveType'], string> = {
  short: '短期归档',
  medium: '中期归档',
  long: '长期归档',
  refined: '精炼归档',
};

export function IrminsulPanel({ memory }: { memory: IrminsulMemory }) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | IrminsulEntry['archiveType']>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const entries = useMemo(
    () => [...memory.entries].sort((left, right) => right.turn - left.turn),
    [memory.entries],
  );
  const activeCount = useMemo(() => getActiveIrminsulEntries(memory).length, [memory]);
  const pendingCount = entries.length - activeCount;

  const typeCounts = useMemo(() => {
    const counts = new Map<IrminsulEntry['archiveType'], number>();
    for (const entry of entries) counts.set(entry.archiveType, (counts.get(entry.archiveType) ?? 0) + 1);
    return counts;
  }, [entries]);

  const filtered = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
    return entries.filter((entry) => {
      if (typeFilter !== 'all' && entry.archiveType !== typeFilter) return false;
      if (terms.length === 0) return true;
      const source = [entry.title, entry.summary, entry.sourceText, ...entry.keywords].join('\n').toLocaleLowerCase();
      return terms.every((term) => source.includes(term));
    });
  }, [entries, typeFilter, query]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const typeFilters: Array<{ id: 'all' | IrminsulEntry['archiveType']; label: string }> = [
    { id: 'all', label: `全部 ${entries.length}` },
    { id: 'short', label: `短期 ${typeCounts.get('short') ?? 0}` },
    { id: 'medium', label: `中期 ${typeCounts.get('medium') ?? 0}` },
    { id: 'long', label: `长期 ${typeCounts.get('long') ?? 0}` },
    { id: 'refined', label: `精炼 ${typeCounts.get('refined') ?? 0}` },
  ];

  return (
    <section className="flex h-full flex-col text-[rgb(var(--tj-text-primary))]">
      <header className="border-b border-[rgba(var(--tj-accent-primary),0.3)] px-4 pb-3 pt-4">
        <p className="font-serif text-xs tracking-[0.3em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>IRMIN SUL</p>
        <h2 className="mt-1 font-serif text-2xl tracking-[0.18em]">世界树 · 记忆账本</h2>
        <p className="mt-1 text-xs" style={{ color: 'rgba(var(--tj-text-secondary),0.85)' }}>
          旅途的每一页都会归档于此；召回时可按关键词取回。
        </p>
        <p className="mt-2 text-xs" style={{ color: 'rgba(var(--tj-text-secondary),0.9)' }}>
          可召回 {activeCount} · 待重试 {pendingCount}
        </p>
      </header>

      <div className="space-y-2 px-4 py-3">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题、摘要、关键词或归档正文……"
          aria-label="搜索世界树记忆"
          className="w-full px-3 py-2 text-sm"
          style={{ background: 'rgba(0,0,0,0.22)', color: 'rgba(var(--tj-text-primary),0.95)', boxShadow: insetRing(0.25), clipPath: CLIP_ITEM }}
        />
        <div className="flex flex-wrap gap-1">
          {typeFilters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTypeFilter(item.id)}
              className="px-2 py-1 text-[11px] tracking-[0.1em]"
              style={{
                color: typeFilter === item.id ? 'rgb(var(--tj-on-accent))' : 'rgba(var(--tj-text-secondary),0.85)',
                background: typeFilter === item.id ? 'rgba(var(--tj-accent-primary),0.8)' : 'rgba(var(--tj-accent-primary),0.06)',
                clipPath: CLIP_ITEM,
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: 'rgba(var(--tj-text-secondary),0.8)' }}>
            {entries.length === 0 ? '尚无可召回的记忆条目。' : '没有匹配的记忆条目。'}
          </p>
        ) : (
          <div className="space-y-3">
            {filtered.map((entry) => {
              const expanded = expandedIds.has(entry.id);
              return (
                <article key={entry.id} className="p-3" style={{ background: 'rgba(var(--tj-bubble),0.6)', boxShadow: insetRing(0.2), clipPath: CLIP_ITEM }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="px-1.5 py-0.5 text-[10px] tracking-[0.14em]" style={{ color: 'rgba(var(--tj-accent-primary),0.9)', boxShadow: insetRing(0.35) }}>
                        {ARCHIVE_TYPE_LABELS[entry.archiveType]}
                      </span>
                      {entry.status === 'pending' && (
                        <span className="px-1.5 py-0.5 text-[10px]" style={{ color: 'rgba(var(--tj-text-secondary),0.95)', boxShadow: insetRing(0.35) }}>
                          待重试 · 暂不召回
                        </span>
                      )}
                    </div>
                    <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary),0.7)' }}>
                      回合 {entry.turn}{entry.sourceTurns.length > 1 ? ` · 源自 ${entry.sourceTurns.length} 个回合` : ''}
                    </span>
                  </div>
                  <h3 className="mt-1.5 font-serif text-lg">{entry.title}</h3>
                  <p className="mt-1.5 text-sm leading-6" style={{ color: 'rgba(var(--tj-text-secondary),0.92)' }}>{entry.summary}</p>
                  {entry.sourceTurns.length > 0 && (
                    <p className="mt-1 text-xs" style={{ color: 'rgba(var(--tj-text-secondary),0.75)' }}>
                      来源回合 {entry.sourceTurns.join('、')}
                    </p>
                  )}
                  {entry.keywords.length > 0 && (
                    <p className="mt-2 text-xs" style={{ color: 'rgba(var(--tj-accent-primary),0.85)' }}>{entry.keywords.join(' · ')}</p>
                  )}
                  {entry.status !== 'pending' && entry.sourceText && (
                    <>
                      {expanded && (
                        <p className="mt-2 whitespace-pre-wrap border-l-2 pl-3 text-xs leading-6" style={{ borderColor: 'rgba(var(--tj-accent-primary),0.4)', color: 'rgba(var(--tj-text-secondary),0.85)' }}>
                          {entry.sourceText}
                        </p>
                      )}
                      <button type="button" onClick={() => toggleExpanded(entry.id)} className="mt-2 text-[11px]" style={{ color: 'rgba(var(--tj-accent-primary),0.9)' }}>
                        {expanded ? '收起归档原文' : '查看归档原文'}
                      </button>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
