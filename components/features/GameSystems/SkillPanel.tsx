import { useMemo, useState } from 'react';
import type { 角色数据结构 } from '@/models/character';
import type { API设置 } from '@/models/settings';
import type { Talent, TalentCategory } from '@/models/teyvat/character';
import { ELEMENT_IDS, type ElementId } from '@/models/teyvat/elements';
import { ELEMENT_COLORS, ELEMENT_NAMES as ELEMENT_LABELS } from '@/styles/elementTokens';
import { generateTalentDraft } from '@/services/ai/skillGenerator';

interface SkillPanelProps {
  traveler: 角色数据结构;
  onTravelerChange: React.Dispatch<React.SetStateAction<角色数据结构>>;
  apiSettings?: API设置;
}

const CATEGORY_LABELS: Record<TalentCategory, string> = {
  normal_attack: '普通攻击', elemental_skill: '元素战技', elemental_burst: '元素爆发', passive: '固有天赋',
};

const CATEGORY_ORDER: TalentCategory[] = ['normal_attack', 'elemental_skill', 'elemental_burst', 'passive'];
const MAX_TALENT_LEVEL = 20;

const gold = 'rgb(var(--tj-accent-primary))';
const goldSoft = (alpha: number) => `rgba(var(--tj-accent-primary), ${alpha})`;
const ink = (alpha: number) => `rgba(var(--tj-text-primary), ${alpha})`;
const muted = (alpha: number) => `rgba(var(--tj-text-secondary), ${alpha})`;
const clipSmall = 'polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px)';

export function SkillPanel({ traveler, onTravelerChange, apiSettings }: SkillPanelProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<TalentCategory>('elemental_skill');
  const [element, setElement] = useState<ElementId | ''>(traveler.主元素);
  const [generating, setGenerating] = useState(false);
  const [generationMessage, setGenerationMessage] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ 名称: string; 说明: string }>({ 名称: '', 说明: '' });
  const unlockedElements = useMemo(() => traveler.元素共鸣.filter((entry) => entry.unlocked).map((entry) => entry.element), [traveler.元素共鸣]);

  const grouped = useMemo(() => {
    const groups = new Map<ElementId | 'general', Talent[]>();
    for (const talent of traveler.天赋) {
      const key = talent.关联元素 || 'general';
      const list = groups.get(key) ?? [];
      list.push(talent);
      groups.set(key, list);
    }
    for (const list of groups.values()) list.sort((a, b) => CATEGORY_ORDER.indexOf(a.类别) - CATEGORY_ORDER.indexOf(b.类别) || a.名称.localeCompare(b.名称, 'zh'));
    return [...ELEMENT_IDS, 'general' as const].filter((key) => groups.has(key)).map((key) => ({ element: key, talents: groups.get(key)! }));
  }, [traveler.天赋]);

  const activeConfig = apiSettings?.configs.find((item) => item.id === apiSettings.activeConfigId) ?? apiSettings?.configs[0] ?? null;

  const addTalent = (talent: Talent) => {
    onTravelerChange((current) => ({ ...current, 天赋: [...current.天赋, talent] }));
  };

  const handleManualAdd = () => {
    if (!name.trim() || !description.trim()) return;
    if (element && !unlockedElements.includes(element)) return;
    addTalent({
      id: `talent_${Date.now()}`,
      名称: name.trim(),
      类别: category,
      关联元素: element,
      等级: 1,
      说明: description.trim(),
    });
    setName('');
    setDescription('');
  };

  const handleGenerateDraft = async () => {
    if (!activeConfig || generating) return;
    if (element && !unlockedElements.includes(element)) {
      setGenerationMessage('该元素尚未觉醒，不能生成对应天赋。');
      return;
    }
    setGenerating(true);
    setGenerationMessage('正在草拟天赋……');
    try {
      const draft = await generateTalentDraft(activeConfig, {
        category,
        element: element || '',
        characterSummary: [traveler.姓名 || '旅人', traveler.性格, traveler.背景, description.trim()].filter(Boolean).join('；'),
        existingTalentNames: traveler.天赋.map((talent) => talent.名称),
      });
      addTalent({ ...draft, id: `talent_${Date.now()}` });
      setGenerationMessage(`已生成草稿「${draft.名称}」，可继续调整。`);
    } catch (error) {
      setGenerationMessage(`生成失败：${error instanceof Error ? error.message : '请检查 API 配置。'}`);
    } finally {
      setGenerating(false);
    }
  };

  const changeLevel = (id: string, delta: number) => {
    onTravelerChange((current) => ({
      ...current,
      天赋: current.天赋.map((talent) => talent.id === id
        ? { ...talent, 等级: Math.max(1, Math.min(MAX_TALENT_LEVEL, talent.等级 + delta)) }
        : talent),
    }));
  };

  const removeTalent = (id: string) => {
    onTravelerChange((current) => ({ ...current, 天赋: current.天赋.filter((talent) => talent.id !== id) }));
  };

  const startEdit = (talent: Talent) => {
    setEditingId(talent.id);
    setEditDraft({ 名称: talent.名称, 说明: talent.说明 });
  };

  const commitEdit = (id: string) => {
    onTravelerChange((current) => ({
      ...current,
      天赋: current.天赋.map((talent) => talent.id === id
        ? { ...talent, 名称: editDraft.名称.trim() || talent.名称, 说明: editDraft.说明.trim() || talent.说明 }
        : talent),
    }));
    setEditingId(null);
  };

  const renderElementBadge = (element: ElementId | '', extraClass = '') => element ? (
    <span
      className={`inline-block px-1.5 py-0.5 text-[10px] leading-none ${extraClass}`}
      style={{ color: ELEMENT_COLORS[element], boxShadow: `inset 0 0 0 1px ${ELEMENT_COLORS[element]}`, clipPath: clipSmall }}
    >
      {ELEMENT_LABELS[element]}
    </span>
  ) : (
    <span className="inline-block px-1.5 py-0.5 text-[10px] leading-none" style={{ color: muted(0.7), boxShadow: `inset 0 0 0 1px ${muted(0.3)}`, clipPath: clipSmall }}>通用</span>
  );

  return (
    <div className="space-y-4">
      <header className="px-4 py-3" style={{ background: 'rgba(var(--tj-panel-bg-start),0.72)', boxShadow: `inset 0 0 0 1px ${goldSoft(0.24)}` }}>
        <div className="font-serif text-sm tracking-[0.3em]" style={{ color: gold }}>旅行者天赋手账</div>
        <p className="mt-2 text-xs leading-6" style={{ color: muted(0.82) }}>
          记录普通攻击、元素战技、元素爆发与固有天赋；元素关联只接受七种正式元素。共 {traveler.天赋.length} 条。
        </p>
      </header>

      <div className="grid gap-3 p-4 sm:grid-cols-2" style={{ background: 'rgba(var(--tj-panel-bg-end),0.48)' }}>
        <input className="teyvat-input px-3 py-2 text-sm" value={name} onChange={(event) => setName(event.target.value)} placeholder="天赋名称" aria-label="天赋名称" />
        <select className="teyvat-input px-3 py-2 text-sm" value={category} onChange={(event) => setCategory(event.target.value as TalentCategory)} aria-label="天赋类别">
          {Object.entries(CATEGORY_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <select className="teyvat-input px-3 py-2 text-sm" value={element} onChange={(event) => setElement(event.target.value as ElementId | '')} aria-label="关联元素">
          <option value="">无元素关联</option>
          {unlockedElements.map((id) => <option key={id} value={id}>{ELEMENT_LABELS[id]}</option>)}
        </select>
        <input className="teyvat-input px-3 py-2 text-sm" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="效果与限制" aria-label="效果与限制" />
        <button type="button" onClick={handleManualAdd} className="teyvat-btn teyvat-btn-primary px-4 py-2 text-sm sm:col-span-2">登记天赋</button>
        {activeConfig && (
          <button
            type="button"
            onClick={() => void handleGenerateDraft()}
            disabled={generating}
            className="teyvat-btn teyvat-btn-secondary px-4 py-2 text-xs sm:col-span-2 disabled:opacity-50"
          >
            <span className="relative">{generating ? '草拟中……' : '✦ 让 AI 草拟一个天赋（按上方类别与元素）'}</span>
          </button>
        )}
        {generationMessage && (
          <p className="text-[11px] leading-5 sm:col-span-2" style={{ color: generationMessage.startsWith('生成失败') ? 'rgba(var(--tj-danger),0.9)' : muted(0.8) }}>
            {generationMessage}
          </p>
        )}
      </div>

      <div className="space-y-4">
        {grouped.length === 0 && <div className="px-4 py-8 text-center text-sm" style={{ color: muted(0.68) }}>手账还是空白，登记第一条天赋吧。</div>}
        {grouped.map(({ element: groupElement, talents }) => (
          <section key={groupElement}>
            <h3 className="mb-2 flex items-center gap-2 font-serif text-[13px] tracking-[0.22em]" style={{ color: gold }}>
              {groupElement === 'general' ? '通用天赋' : `${ELEMENT_LABELS[groupElement]}元素天赋`}
              <span className="h-px flex-1" style={{ background: goldSoft(0.2) }} />
              <span className="text-[11px]" style={{ color: muted(0.6) }}>{talents.length} 条</span>
            </h3>
            <div className="space-y-2">
              {talents.map((talent) => {
                const editing = editingId === talent.id;
                return (
                  <article key={talent.id} className="p-4" style={{ background: 'rgba(var(--tj-panel-bg-end),0.54)', boxShadow: `inset 0 0 0 1px ${muted(0.16)}`, clipPath: clipSmall }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-serif text-sm" style={{ color: ink(0.95) }}>{talent.名称}</span>
                          {renderElementBadge(talent.关联元素)}
                        </div>
                        <div className="mt-1 text-[11px]" style={{ color: muted(0.7) }}>
                          {CATEGORY_LABELS[talent.类别]} · Lv.{talent.等级}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={() => changeLevel(talent.id, -1)} disabled={talent.等级 <= 1} aria-label={`${talent.名称} 降级`} className="h-7 w-7 text-xs disabled:opacity-30" style={{ color: ink(0.85), boxShadow: `inset 0 0 0 1px ${muted(0.25)}`, clipPath: clipSmall }}>−</button>
                        <button type="button" onClick={() => changeLevel(talent.id, 1)} disabled={talent.等级 >= MAX_TALENT_LEVEL} aria-label={`${talent.名称} 升级`} className="h-7 w-7 text-xs disabled:opacity-30" style={{ color: ink(0.85), boxShadow: `inset 0 0 0 1px ${muted(0.25)}`, clipPath: clipSmall }}>＋</button>
                        <button type="button" onClick={() => (editing ? commitEdit(talent.id) : startEdit(talent))} className="px-2 py-1 text-xs" style={{ color: goldSoft(0.9) }}>
                          {editing ? '保存' : '编辑'}
                        </button>
                        <button type="button" onClick={() => removeTalent(talent.id)} aria-label={`移除 ${talent.名称}`} className="px-2 py-1 text-xs" style={{ color: 'rgba(var(--tj-danger),0.8)' }}>移除</button>
                      </div>
                    </div>
                    {editing ? (
                      <div className="mt-3 space-y-2">
                        <input className="teyvat-input w-full px-3 py-2 text-sm" value={editDraft.名称} onChange={(event) => setEditDraft((draft) => ({ ...draft, 名称: event.target.value }))} aria-label="编辑天赋名称" />
                        <textarea className="teyvat-input w-full resize-none px-3 py-2 text-sm leading-6" rows={3} value={editDraft.说明} onChange={(event) => setEditDraft((draft) => ({ ...draft, 说明: event.target.value }))} aria-label="编辑天赋说明" />
                      </div>
                    ) : (
                      <p className="mt-3 text-sm leading-6" style={{ color: muted(0.84) }}>{talent.说明}</p>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
