import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BUILTIN_IMAGE_PROMPT_LIBRARY, IMAGE_PROMPT_CATEGORIES, type ImagePromptCategory, type ImagePromptSelection, type ImagePromptSnippet } from '@/utils/imagePromptLibrary';
import type { ImagePromptLibraryStore } from '@/utils/createImagePromptLibraryStore';
export interface ImagePromptLibraryPickerProps {
  onApply: (selection: ImagePromptSelection) => void;
  disabled?: boolean;
  store: ImagePromptLibraryStore;
}
const buttonClass = 'teyvat-btn min-h-11 px-3 text-xs';
export function ImagePromptLibraryPickerBase({ onApply, disabled = false, store }: ImagePromptLibraryPickerProps) {
  const library = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState<ImagePromptSnippet | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [formError, setFormError] = useState('');
  const formInput = useRef<HTMLInputElement>(null);
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const editingId = form?.id;
  useEffect(() => { void store.load(); }, [store]);
  useEffect(() => { if (editingId) formInput.current?.focus(); else editTrigger.current?.focus(); }, [editingId]);
  const filtered = useMemo(() => [...BUILTIN_IMAGE_PROMPT_LIBRARY, ...library.items].filter(item =>
    (category === '全部' || item.category === category)
    && `${item.name} ${item.category} ${item.positive} ${item.negative}`.toLowerCase().includes(search.trim().toLowerCase())), [category, library.items, search]);
  const selected = filtered.find(item => item.id === selectedId) ?? filtered[0];
  const customSelected = selected?.id.startsWith('custom-');
  const editingDisabled = disabled || library.saving;
  const startEdit = (item: ImagePromptSnippet, trigger: HTMLButtonElement) => {
    editTrigger.current = trigger; setForm({ ...item }); setConfirmDelete(null); setFormError(''); setStatus('');
  };
  const save = async () => {
    if (!form || editingDisabled) return;
    const pending = { ...form };
    setFormError(''); setStatus('');
    try {
      await store.upsert(pending);
      setSelectedId(pending.id); setSearch(''); setCategory('全部'); setForm(null); setStatus('已保存到本地设置，手机与相册共用。');
    } catch (error) { setFormError(error instanceof Error ? error.message : String(error)); }
  };
  const remove = async () => {
    if (!confirmDelete || editingDisabled) return;
    try {
      await store.remove(confirmDelete); setConfirmDelete(null); setSelectedId(''); setStatus('已删除自定义词组。'); setFormError('');
    } catch (error) { setFormError(error instanceof Error ? error.message : String(error)); }
  };
  const apply = (side: 'positive' | 'negative' | 'both') => {
    if (!selected || disabled) return;
    onApply({ ...(side !== 'negative' ? { positive: selected.positive } : {}), ...(side !== 'positive' ? { negative: selected.negative } : {}) });
    setStatus(`已追加${side === 'both' ? '正面与负面' : side === 'positive' ? '正面' : '负面'}词组，重复词组不会再次添加。`);
  };
  return <section aria-label="生图提示词库" className="my-3 min-w-0 rounded-xl border p-3" style={{ color: 'rgb(var(--tj-text-primary))', borderColor: 'rgba(var(--tj-accent-primary),0.3)' }}>
    <details>
      <summary className="min-h-11 cursor-pointer py-2 font-serif text-sm">生图提示词库 · 快速选词</summary>
      <p className="mb-3 text-xs leading-relaxed">先生成或编辑提示词，再追加词组。只追加当前草稿，不替换角色资料与玩家要求；重新生成提示词会重建草稿。选择不调用 API，确认生成才调用，发送时沿用自动精简。</p>
      <div className="grid min-w-0 gap-2 sm:grid-cols-[1fr_auto]">
        <input aria-label="搜索提示词" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索名称或提示词" className="teyvat-input min-h-11 min-w-0 w-full" />
        <select aria-label="提示词分类" value={category} onChange={event => setCategory(event.target.value)} className="teyvat-input min-h-11 min-w-0">
          <option>全部</option>{IMAGE_PROMPT_CATEGORIES.map(value => <option key={value}>{value}</option>)}
        </select>
      </div>
      <div className="my-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto" aria-label="词组列表">
        {filtered.map(item => <button key={item.id} type="button" aria-pressed={selected?.id === item.id} onClick={() => { setSelectedId(item.id); setConfirmDelete(null); }} className={`${buttonClass} ${selected?.id === item.id ? 'teyvat-btn-primary' : ''}`}>{item.name}</button>)}
        {!filtered.length && <p className="py-2 text-xs">没有匹配的词组，试试清空搜索或切换分类。</p>}
      </div>
      {selected && <div className="min-w-0 rounded-lg border p-3 text-xs" style={{ borderColor: 'rgba(var(--tj-accent-primary),0.2)' }}>
        <p>{selected.name} · {selected.category} · {customSelected ? '自定义' : '内置只读'}</p>
        <p className="mt-2">正面</p><p aria-label="词组正面预览" className="max-h-28 overflow-y-auto break-words whitespace-pre-wrap leading-relaxed">{selected.positive || '（不添加正面）'}</p>
        <p className="mt-2">负面</p><p aria-label="词组负面预览" className="max-h-28 overflow-y-auto break-words whitespace-pre-wrap leading-relaxed">{selected.negative || '（不添加负面）'}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={buttonClass} disabled={disabled || !selected.positive} onClick={() => apply('positive')}>追加正面</button>
          <button type="button" className={buttonClass} disabled={disabled || !selected.negative} onClick={() => apply('negative')}>追加负面</button>
          <button type="button" className={buttonClass} disabled={disabled} onClick={() => apply('both')}>追加两者</button>
          {customSelected && <>
            <button type="button" className={buttonClass} disabled={editingDisabled || Boolean(form)} onClick={event => startEdit(selected, event.currentTarget)}>编辑词组</button>
            <button type="button" className={buttonClass} disabled={editingDisabled || Boolean(form)} onClick={() => { setConfirmDelete(selected.id); setStatus(''); }}>删除词组</button>
          </>}
        </div>
      </div>}
      {confirmDelete && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span>删除此自定义词组？不会修改已有生图草稿。</span>
        <button type="button" className={buttonClass} disabled={editingDisabled} onClick={() => { void remove(); }}>确认删除</button>
        <button type="button" className={buttonClass} disabled={library.saving} onClick={() => setConfirmDelete(null)}>取消删除</button>
      </div>}
      <button type="button" className={`${buttonClass} mt-3`} disabled={editingDisabled || !library.ready || Boolean(form)} onClick={event => startEdit({ id: `custom-${crypto.randomUUID()}`, name: '', category: '自定义', positive: '', negative: '' }, event.currentTarget)}>新增词组</button>
      {form && <form className="mt-3 grid min-w-0 gap-2" onSubmit={event => { event.preventDefault(); void save(); }}>
        <label className="text-xs">词组名称<input ref={formInput} aria-label="词组名称" required maxLength={80} value={form.name} disabled={editingDisabled} onChange={event => setForm({ ...form, name: event.target.value })} className="teyvat-input mt-1 min-h-11 w-full" /></label>
        <label className="text-xs">分类<select aria-label="自定义词组分类" value={form.category} disabled={editingDisabled} onChange={event => setForm({ ...form, category: event.target.value as ImagePromptCategory })} className="teyvat-input ml-2 min-h-11">{IMAGE_PROMPT_CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="text-xs">正面提示词<textarea aria-label="自定义正面提示词" rows={3} value={form.positive} disabled={editingDisabled} onChange={event => setForm({ ...form, positive: event.target.value })} className="teyvat-input mt-1 w-full" /></label>
        <label className="text-xs">负面提示词<textarea aria-label="自定义负面提示词" rows={3} value={form.negative} disabled={editingDisabled} onChange={event => setForm({ ...form, negative: event.target.value })} className="teyvat-input mt-1 w-full" /></label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={buttonClass} disabled={editingDisabled || !form.name.trim() || !(form.positive.trim() || form.negative.trim())}>{library.saving ? '保存中…' : '保存词组'}</button>
          <button type="button" className={buttonClass} disabled={library.saving} onClick={() => { setForm(null); setFormError(''); }}>取消编辑</button>
        </div>
      </form>}
      {library.loading && <p className="mt-2 text-xs">正在读取本地词组…</p>}
      {(formError || library.error) && <p role="alert" className="mt-2 break-words text-xs">{formError || library.error}</p>}
      {!library.ready && !library.loading && library.error && <button type="button" className={`${buttonClass} mt-2`} onClick={() => { void store.load(); }}>重试读取</button>}
      <p role="status" aria-label="提示词库操作状态" className="mt-2 break-words text-xs">{status}</p>
    </details>
  </section>;
}
