import { CLIP_ITEM, CLIP_SECTION } from '@/styles/clipPaths';
import { useMemo, useState } from 'react';
import type { ArchiveCodex, CodexEntry } from '@/models/teyvat';
import { buildCodexArchiveItems } from './productionAdapter';
import { buildCodexEntryInjectionPreview, retrieveCodexEntries } from '@/services/codexRetrieval';
import { useModalAccessibility } from '@/components/ui/Modal';

export interface CodexManagerModalProps {
  codex: ArchiveCodex;
  onClose: () => void;
}

const gold = 'rgb(var(--tj-accent-primary))';
const goldSoft = (alpha: number) => `rgba(var(--tj-accent-primary), ${alpha})`;
const ink = (alpha: number) => `rgba(var(--tj-text-primary), ${alpha})`;
const muted = (alpha: number) => `rgba(var(--tj-text-secondary), ${alpha})`;


/** 图鉴分类 slug → 中文名（预设文件的分类字段为英文 slug）。 */
const CATEGORY_LABELS: Record<string, string> = {
  character: '角色',
  location: '地点',
  term: '术语',
  lore: '传说',
  faction: '势力',
  worldview: '世界观',
  element: '元素',
};

const categoryName = (slug: string): string => CATEGORY_LABELS[slug] ?? slug;

const USAGE_LABELS: Array<{ key: keyof CodexEntry['usage']; label: string }> = [
  { key: 'narrative', label: '主剧情' },
  { key: 'courier', label: '手机' },
  { key: 'steambird', label: '蒸汽鸟报' },
  { key: 'variables', label: '变量' },
];

function entryMatchesQuery(entry: CodexEntry, query: string): boolean {
  const source = [entry.name, entry.category, entry.summary, entry.description, entry.source, ...entry.tags, ...entry.keywords]
    .join('\n')
    .toLocaleLowerCase();
  return query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean)
    .every((term) => source.includes(term));
}

export function CodexManagerModal({ codex, onClose }: CodexManagerModalProps) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dialogRef = useModalAccessibility<HTMLElement>(onClose);

  const items = useMemo(() => buildCodexArchiveItems(codex), [codex]);
  const entryById = useMemo(() => new Map(codex.entries.map((entry) => [entry.id, entry])), [codex]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || categoryName(left[0]).localeCompare(categoryName(right[0]), 'zh'));
  }, [items]);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const listItems = useMemo(() => {
    return items.filter((item) => {
      if (activeCategory !== 'all' && item.category !== activeCategory) return false;
      if (!query.trim()) return true;
      const entry = entryById.get(item.id);
      return entry ? entryMatchesQuery(entry, query) : false;
    });
  }, [items, entryById, activeCategory, query]);

  const selectedItem = listItems.find((item) => item.id === selectedId) ?? listItems[0] ?? null;
  const selectedEntry: CodexEntry | null = selectedItem ? entryById.get(selectedItem.id) ?? null : null;

  // 用领域检索服务演示：当前搜索词若在回合内出现，会召回并注入哪些条目。
  const recallPreview = useMemo(() => {
    if (!query.trim()) return null;
    const result = retrieveCodexEntries(codex, query, 5);
    const visibleIds = new Set(listItems.map((item) => item.id));
    const visibleEntries = result.entries.filter((entry) => visibleIds.has(entry.id));
    return visibleEntries.length ? visibleEntries : null;
  }, [codex, query, listItems]);

  const relatedEntries = useMemo(() => {
    if (!selectedEntry?.relatedEntryIds?.length) return [];
    return selectedEntry.relatedEntryIds
      .map((id) => entryById.get(id))
      .filter((entry): entry is CodexEntry => Boolean(entry));
  }, [selectedEntry, entryById]);

  const injectionSections = useMemo(() => {
    if (!selectedEntry) return [];
    const injection = selectedEntry.injection;
    const sections: Array<{ label: string; value?: string }> = [
      { label: '身份与阵营', value: injection.identityAndFaction },
      { label: '性格与行为', value: injection.personalityAndBehavior },
      { label: '说话方式', value: injection.speechStyle },
      { label: '对话示例', value: injection.dialogueSamples },
      { label: '外貌锚点', value: injection.appearanceAnchor },
      { label: '当前形态与限制', value: injection.currentFormAndLimits },
      { label: '简要故事', value: injection.conciseStory },
      { label: '演绎边界', value: injection.portrayalBoundaries },
      { label: '定义', value: injection.definition },
      { label: '事实', value: injection.facts },
      { label: '叙事用法', value: injection.narrativeUse },
      { label: '边界', value: injection.boundaries },
    ];
    return sections.filter((section) => section.value?.trim());
  }, [selectedEntry]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 sm:p-4">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="提瓦特图鉴"
        tabIndex={-1}
        className="journal-story-page grid h-[100dvh] w-full grid-cols-1 overflow-hidden sm:h-[min(86vh,760px)] sm:w-[min(1020px,100%)] sm:grid-cols-[minmax(280px,38%)_1fr]"
        style={{
          background: 'linear-gradient(180deg, var(--journal-parchment), color-mix(in srgb, var(--journal-parchment) 86%, var(--journal-leather) 14%))',
          boxShadow: `inset 0 0 0 1px ${goldSoft(0.35)}, 0 24px 60px rgba(0, 0, 0, 0.5)`,
          clipPath: CLIP_SECTION,
        }}
      >
        {/* ── 检索与条目列表 ── */}
        <aside className="flex min-h-0 flex-col border-r border-[rgba(var(--tj-accent-primary),0.2)]">
          <header className="flex items-center justify-between px-4 pb-2 pt-4">
            <div>
              <p className="text-[10px] tracking-[0.3em]" style={{ color: gold }}>ARCHIVE CODEX</p>
              <h2 className="font-serif text-lg tracking-[0.14em]">提瓦特图鉴</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭图鉴"
              className="flex h-9 w-9 items-center justify-center text-base"
              style={{ color: ink(0.85), boxShadow: `inset 0 0 0 1px ${goldSoft(0.3)}`, clipPath: CLIP_ITEM }}
            >
              ✕
            </button>
          </header>
          <div className="px-3">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、关键词、摘要或来源……"
              aria-label="搜索图鉴条目"
              className="w-full px-3 py-2 text-sm"
              style={{ background: 'rgba(0,0,0,0.24)', color: ink(0.96), boxShadow: `inset 0 0 0 1px ${goldSoft(0.25)}`, clipPath: CLIP_ITEM }}
            />
            {categories.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {['all', ...categories.map(([category]) => category)].map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setActiveCategory(category)}
                    className="px-2 py-0.5 text-[11px]"
                    style={{
                      color: activeCategory === category ? gold : muted(0.8),
                      boxShadow: `inset 0 0 0 1px ${activeCategory === category ? goldSoft(0.5) : goldSoft(0.14)}`,
                      clipPath: CLIP_ITEM,
                    }}
                  >
                    {category === 'all' ? '全部' : categoryName(category)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {listItems.length === 0 ? (
              <p className="px-1 py-8 text-center text-xs leading-6" style={{ color: muted(0.75) }}>
                {query.trim() ? '没有匹配的条目。' : activeCategory === 'all' ? '图鉴尚无条目。' : '当前分类暂无条目。'}
              </p>
            ) : (
              listItems.map((item) => {
                const active = selectedEntry?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className="mb-2 w-full px-3 py-2.5 text-left transition-colors"
                    style={{
                      background: active ? goldSoft(0.12) : goldSoft(0.04),
                      boxShadow: `inset 0 0 0 1px ${active ? goldSoft(0.5) : goldSoft(0.16)}`,
                      clipPath: CLIP_ITEM,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong className="min-w-0 truncate font-serif text-sm tracking-wide" style={{ color: ink(0.96) }}>
                        {item.name}
                      </strong>
                      <span className="shrink-0 text-[10px] tracking-[0.12em]" style={{ color: goldSoft(0.8) }}>{categoryName(item.category)}</span>
                    </div>
                    {item.summary && (
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-5" style={{ color: muted(0.78) }}>{item.summary}</p>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ── 条目详情 ── */}
        <main className="flex min-h-0 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-[rgba(var(--tj-accent-primary),0.2)] px-5 py-3">
            <div className="min-w-0">
              <p className="text-[10px] tracking-[0.25em]" style={{ color: goldSoft(0.85) }}>{selectedEntry ? categoryName(selectedEntry.category) : '词条'}</p>
              <h3 className="truncate font-serif text-xl tracking-wide">
                {selectedEntry?.name ?? '未选择条目'}
              </h3>
            </div>
            {selectedEntry && (
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {USAGE_LABELS.filter(({ key }) => selectedEntry.usage[key]).map(({ key, label }) => (
                  <span key={key} className="px-1.5 py-0.5 text-[10px]" style={{ color: goldSoft(0.9), boxShadow: `inset 0 0 0 1px ${goldSoft(0.35)}`, clipPath: CLIP_ITEM }}>
                    {label}
                  </span>
                ))}
              </div>
            )}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {!selectedEntry ? (
              <p className="py-12 text-center text-sm leading-6" style={{ color: muted(0.75) }}>
                从左侧选择一个条目，查看它的档案与注入预览。
              </p>
            ) : (
              <div className="space-y-4">
                {selectedEntry.summary && (
                  <p className="text-sm leading-7" style={{ color: ink(0.94) }}>{selectedEntry.summary}</p>
                )}
                {selectedEntry.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedEntry.tags.map((tag) => (
                      <span key={tag} className="px-2 py-0.5 text-[11px]" style={{ color: goldSoft(0.9), boxShadow: `inset 0 0 0 1px ${goldSoft(0.3)}`, clipPath: CLIP_ITEM }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {injectionSections.length > 0 && (
                  <section>
                    <h4 className="mb-2 font-serif text-[13px] tracking-[0.2em]" style={{ color: gold }}>档案注入内容</h4>
                    <div className="space-y-2">
                      {injectionSections.map((section) => (
                        <div key={section.label} className="px-3 py-2" style={{ background: goldSoft(0.04), boxShadow: `inset 0 0 0 1px ${goldSoft(0.14)}`, clipPath: CLIP_ITEM }}>
                          <p className="text-[10px] tracking-[0.2em]" style={{ color: goldSoft(0.8) }}>{section.label}</p>
                          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-6" style={{ color: ink(0.92) }}>{section.value}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
                {(
                  <section>
                    <h4 className="mb-2 font-serif text-[13px] tracking-[0.2em]" style={{ color: gold }}>回合内注入预览</h4>
                    <p className="whitespace-pre-wrap border-l-2 pl-3 text-[13px] leading-6" style={{ borderColor: goldSoft(0.5), color: muted(0.9) }}>
                      {buildCodexEntryInjectionPreview(selectedEntry) || '（无注入内容）'}
                    </p>
                  </section>
                )}
                {relatedEntries.length > 0 && (
                  <section>
                    <h4 className="mb-2 font-serif text-[13px] tracking-[0.2em]" style={{ color: gold }}>关联条目</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {relatedEntries.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => { setActiveCategory(entry.category); setSelectedId(entry.id); }}
                          className="px-2 py-1 text-[12px]"
                          style={{ color: goldSoft(0.92), boxShadow: `inset 0 0 0 1px ${goldSoft(0.3)}`, clipPath: CLIP_ITEM }}
                        >
                          {entry.name}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {selectedEntry.source && (
                  <p className="text-[11px]" style={{ color: muted(0.6) }}>资料来源：{selectedEntry.source}</p>
                )}
              </div>
            )}
          </div>

          {recallPreview && (
            <footer className="border-t border-[rgba(var(--tj-accent-primary),0.2)] px-5 py-2.5">
              <p className="text-[11px] leading-5" style={{ color: muted(0.8) }}>
                <span style={{ color: goldSoft(0.9) }}>召回预览：</span>
                若当前搜索词出现在正文中，将注入 {recallPreview.length} 条 → {recallPreview.map((entry) => entry.name).join('、')}
              </p>
            </footer>
          )}
        </main>
      </section>
    </div>
  );
}
