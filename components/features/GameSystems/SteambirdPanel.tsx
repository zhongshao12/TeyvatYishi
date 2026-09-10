import { useMemo, useState } from 'react';
import type { SteambirdNews } from '@/models/teyvat/steambird';

export function SteambirdPanel({ steambird, turnCount }: { steambird: SteambirdNews; turnCount: number }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const articles = useMemo(
    () => [...steambird.articles].sort((left, right) => right.turn - left.turn || right.timestamp - left.timestamp),
    [steambird.articles],
  );

  const headline = articles.find((article) => article.important) ?? articles[0] ?? null;
  const rest = articles.filter((article) => article.id !== headline?.id);

  const sections = useMemo(() => {
    const map = new Map<string, typeof rest>();
    for (const article of rest) {
      const list = map.get(article.section) ?? [];
      list.push(article);
      map.set(article.section, list);
    }
    return [...map.entries()].sort((left, right) => left[0].localeCompare(right[0], 'zh'));
  }, [rest]);

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderBody = (article: (typeof articles)[number], expanded: boolean) => (
    <p className={`whitespace-pre-wrap text-sm leading-7 ${expanded ? '' : 'line-clamp-5'}`} style={{ color: 'rgba(var(--tj-text-secondary),0.95)' }}>
      {article.body}
    </p>
  );

  return (
    <section className="h-full overflow-y-auto p-4 text-[rgb(var(--tj-text-primary))]">
      <header className="border-b-2 border-[rgba(var(--tj-accent-primary),0.45)] pb-3 text-center">
        <p className="font-serif text-xs tracking-[0.4em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>THE STEAMBIRD</p>
        <h2 className="mt-1 font-serif text-3xl tracking-[0.22em]">蒸汽鸟报</h2>
        <p className="mt-1 text-xs" style={{ color: 'rgba(var(--tj-text-secondary),0.9)' }}>
          第 {turnCount} 回 · 提瓦特公开见闻 · 共 {articles.length} 篇
        </p>
      </header>

      {articles.length === 0 ? (
        <p className="py-12 text-center text-sm" style={{ color: 'rgba(var(--tj-text-secondary),0.8)' }}>
          报社尚未收到可刊登的公开消息。随着冒险推进，蒸汽鸟报会刊登提瓦特各地的见闻。
        </p>
      ) : (
        <div className="mt-5 space-y-6">
          {headline && (
            <article className="border-b border-[rgba(var(--tj-accent-primary),0.2)] pb-5">
              <p className="text-xs tracking-[0.2em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
                ★ 头版头条 · {headline.section.toUpperCase()} · 回合 {headline.turn}
              </p>
              <h3 className="mt-2 font-serif text-2xl leading-snug tracking-wide">{headline.title}</h3>
              <div className="mt-3">{renderBody(headline, expandedIds.has(headline.id))}</div>
              {headline.body.length > 180 && (
                <button type="button" onClick={() => toggleExpanded(headline.id)} className="mt-2 text-xs" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
                  {expandedIds.has(headline.id) ? '收起' : '展开全文'}
                </button>
              )}
              {headline.organizationTags.length > 0 && (
                <p className="mt-2 text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary),0.7)' }}>
                  关联势力：{headline.organizationTags.join(' · ')}
                </p>
              )}
            </article>
          )}

          {sections.map(([section, list]) => (
            <section key={section}>
              <h3 className="mb-3 flex items-center gap-2 font-serif text-sm tracking-[0.24em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
                {section}
                <span className="h-px flex-1" style={{ background: 'rgba(var(--tj-accent-primary),0.2)' }} />
                <span className="text-[11px]" style={{ color: 'rgba(var(--tj-text-secondary),0.6)' }}>{list.length} 篇</span>
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                {list.map((article) => {
                  const expanded = expandedIds.has(article.id);
                  return (
                    <article key={article.id} className="p-3" style={{ background: 'rgba(var(--tj-bubble),0.6)', boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary),0.16)', clipPath: 'polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px)' }}>
                      <p className="text-[11px] tracking-[0.14em]" style={{ color: 'rgba(var(--tj-accent-primary),0.85)' }}>
                        {article.important ? '★ ' : ''}回合 {article.turn}
                      </p>
                      <h4 className="mt-1 font-serif text-base leading-snug">{article.title}</h4>
                      <div className="mt-2">{renderBody(article, expanded)}</div>
                      {article.body.length > 120 && (
                        <button type="button" onClick={() => toggleExpanded(article.id)} className="mt-1.5 text-[11px]" style={{ color: 'rgba(var(--tj-accent-primary),0.9)' }}>
                          {expanded ? '收起' : '展开'}
                        </button>
                      )}
                      {article.relatedSystems.length > 0 && (
                        <p className="mt-2 text-[10px]" style={{ color: 'rgba(var(--tj-text-secondary),0.65)' }}>
                          关联：{article.relatedSystems.join(' · ')}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
