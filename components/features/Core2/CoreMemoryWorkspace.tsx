import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CoreRepository } from '@/core/contracts/storage';
import type { BranchHead, SourceRef } from '@/core/contracts/identity';
import { useCore2Query } from '@/hooks/useCore2Query';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { displayCoreMemoryText } from '@/core/retrieval/memoryPresentation';
import type { MemoryEditAction } from '@/core/memory/manualEdits';
import type { DerivedReceipt } from '@/core/contracts/memory';

export interface CoreMemoryPreview { token: string; turns: number[]; modelRequests: number; description: string }
type MemoryEditor = Pick<MemoryEditAction, 'memoryId' | 'expectedVersion' | 'text' | 'pinned' | 'importance'>;
export interface CoreMemoryActions { onPreview(mode: 'compress' | 'rebuild', memoryIds: string[]): Promise<CoreMemoryPreview>; onRun(token: string): Promise<{ kind: 'completed' | 'queued' }>; onEdit(input: MemoryEditor): Promise<DerivedReceipt> }
function MemoryDialog({ title, onClose, children, returnFocus }: { title: string; onClose(): void; children: ReactNode; returnFocus?: HTMLElement | null }) {
  const root = useRef<HTMLDivElement>(null), previous = useRef<HTMLElement | null>(returnFocus ?? null);
  useEffect(() => { previous.current ??= document.activeElement as HTMLElement; root.current?.focus(); return () => previous.current?.focus(); }, []);
  return createPortal(<div className="core2-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className="core2-modal core2-card" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={root} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    if (event.key === 'Tab') { const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),textarea,input,a[href]')]; const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}><h3>{title}</h3>{children}</div></div>, document.body);
}
export function CoreMemoryWorkspace({ repo, head, tree = false, disabled = false, onPreview, onRun, onEdit }: { repo: CoreRepository; head: BranchHead; tree?: boolean; disabled?: boolean } & Partial<CoreMemoryActions>) {
  const [layer, setLayer] = useState<'all' | 'short' | 'middle' | 'long'>('all');
  const view = useCore2Query({ kind: tree ? 'irminsul' : 'memory', head, ...(layer !== 'all' ? { layers: [layer] } : {}) }, repo);
  const [selected, setSelected] = useState<string[]>([]), [preview, setPreview] = useState<CoreMemoryPreview | null>(null), [source, setSource] = useState<SourceRef | null>(null);
  const evidence = useCore2Query(source ? { kind: 'source', head, ref: source } : null, repo);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const generation = useRef({ value: 0 }), identity = `${head.scope.journeyId}:${head.scope.branchId}:${head.sessionId}`;
  const previewTrigger = useRef<HTMLElement | null>(null);
  const [editor, setEditor] = useState<MemoryEditor | null>(null);
  useEffect(() => { const lifetime = generation.current; lifetime.value++; setSelected([]); setPreview(null); setSource(null); setEditor(null); setError(''); return () => { lifetime.value++; }; }, [identity]);
  const saveEdit = async () => {
    if (!editor || !onEdit || disabled || busy) return;
    const token = generation.current.value; setBusy(true); setError('');
    try {
      const receipt = await onEdit(editor);
      if (generation.current.value !== token) return;
      if (receipt.status !== 'published') throw Error(receipt.reason ?? '记忆尚未保存，原记录保留。');
      setEditor(null); setNotice('记忆修改已保存，原文、旧版本和人物知情范围保留。'); view.refresh();
    } catch (failure) { if (generation.current.value === token) setError(sanitizeApiErrorReportText(String(failure))); }
    finally { if (generation.current.value === token) setBusy(false); }
  };
  const prepare = async (mode: 'compress' | 'rebuild') => {
    if (!onPreview || disabled) return; const token = generation.current.value; previewTrigger.current = document.activeElement as HTMLElement; setBusy(true); setError('');
    try { const next = await onPreview(mode, mode === 'compress' ? [] : selected); if (generation.current.value === token) setPreview(next); }
    catch (failure) { if (generation.current.value === token) setError(sanitizeApiErrorReportText(String(failure))); }
    finally { if (generation.current.value === token) setBusy(false); }
  };
  const run = async () => {
    if (!preview || !onRun) return; const token = generation.current.value; setBusy(true); setError('');
    try { const result = await onRun(preview.token); if (generation.current.value !== token) return; setPreview(null); setNotice(result.kind === 'completed' ? '本次整理已完成，原始来源仍保留。' : '整理任务已登记，请在任务列表查看进度。'); view.refresh(); }
    catch (failure) { if (generation.current.value === token) setError(sanitizeApiErrorReportText(String(failure))); }
    finally { if (generation.current.value === token) setBusy(false); }
  };
  return <section className="core2-card core2-memory-workspace" aria-label={tree ? '世界树' : '旅途记忆'}><h2>{tree ? '世界树' : '旅途记忆'}</h2>
    <p>列表每页最多50条。摘要是整理后的阅读视图，原始事件和各版记忆不会因压缩被删除。</p>
    <label>记忆层级<select value={layer} onChange={event => setLayer(event.target.value as typeof layer)}><option value="all">{tree ? '世界树归档' : '全部摘要'}</option><option value="short">短期</option><option value="middle">中期</option><option value="long">长期</option></select></label>
    <div className="core2-panel-actions"><button disabled={disabled || busy || !onPreview} onClick={() => void prepare('compress')}>一键压缩（先预览）</button><button disabled={disabled || busy || !onPreview || !selected.length} onClick={() => void prepare('rebuild')}>重建选中记忆</button><button onClick={view.refresh} disabled={view.loading}>刷新列表</button></div>
    {view.loading && <p role="status">正在读取记忆……</p>}{view.error && <p role="alert">{view.error}</p>}
    {view.items.map(memory => <article key={memory.memoryId} className="core2-memory-entry"><label><input type="checkbox" checked={selected.includes(memory.memoryId)} onChange={event => setSelected(before => event.target.checked ? [...new Set([...before, memory.memoryId])] : before.filter(id => id !== memory.memoryId))} />选择这条记忆</label>
      <small>{memory.layer} · 来源回合 {memory.turns.join('、') || '未记录'} · {memory.generation.mode === 'manual' ? '玩家编辑' : memory.generation.mode === 'model' ? 'AI整理' : '本地整理'}</small><p style={{ whiteSpace: 'pre-wrap' }}>{displayCoreMemoryText(memory)}</p>
      <small>重要性 {memory.importance}{memory.pinned ? ' · 已固定保留' : ''}</small>
      <button disabled={disabled || busy || !onEdit} onClick={() => { previewTrigger.current = document.activeElement as HTMLElement; setError(''); setEditor({ memoryId: memory.memoryId, expectedVersion: memory.version, text: memory.text, pinned: memory.pinned, importance: memory.importance }); }}>编辑记忆</button>
      <p className="core2-memory-moment">{memory.momentRange.start?.worldName} · {memory.momentRange.start?.date} {memory.momentRange.start?.clock} · {memory.momentRange.start?.weather} · {memory.momentRange.start?.location} · 旅行第{memory.momentRange.start?.travelDay ?? '?'}天</p>
      {memory.sourceRefs.map(ref => <button key={`${ref.sourceId}:${ref.sourceVersion}`} onClick={() => setSource(ref)}>查看来源</button>)}</article>)}
    {view.cursor && <button disabled={view.loading} onClick={() => void view.loadMore()}>加载下一页</button>}
    {editor && <MemoryDialog title="编辑记忆" returnFocus={previewTrigger.current} onClose={() => { if (!busy) setEditor(null); }}><p>只修改摘要表述和召回优先程度，不改写已发生的事件、变量或其他角色的知识。</p><label>记忆表述<textarea aria-label="记忆表述" value={editor.text} disabled={busy} onChange={event => setEditor({ ...editor, text: event.target.value })} /></label><label>重要性<input type="number" min="0" aria-label="记忆重要性" value={editor.importance ?? 0} disabled={busy} onChange={event => setEditor({ ...editor, importance: event.target.valueAsNumber })} /></label><label><input type="checkbox" aria-label="固定这条记忆" checked={!!editor.pinned} disabled={busy} onChange={event => setEditor({ ...editor, pinned: event.target.checked })} />固定这条记忆（自动整理时保留）</label><button disabled={disabled || busy || !editor.text.trim() || !Number.isFinite(editor.importance) || (editor.importance ?? 0) < 0} onClick={() => void saveEdit()}>保存记忆</button><button disabled={busy} onClick={() => setEditor(null)}>取消编辑</button>{error && <p role="alert">{error}</p>}</MemoryDialog>}
    {preview && <MemoryDialog title="确认记忆整理范围" returnFocus={previewTrigger.current} onClose={() => { if (!busy) setPreview(null); }}><p>{preview.description}</p><p>实际来源回合：{preview.turns.join('、')}</p><p>{preview.modelRequests} 次基础请求；分层整理与失败重试另行计量。</p><p>只有全部选中步骤完成并核对来源后才替换整理视图；失败、停止或切档不会覆盖有效记忆。</p><button disabled={busy || !onRun} onClick={() => void run()}>确认执行</button><button disabled={busy} onClick={() => setPreview(null)}>取消</button></MemoryDialog>}
    {source && <MemoryDialog title="原始来源" onClose={() => setSource(null)}>{evidence.loading ? <p role="status">正在读取来源……</p> : evidence.error ? <p role="alert">{evidence.error}</p> : evidence.items.map(item => <article key={item.ref.sourceId}>{item.blocks.filter(block => block.kind !== 'configuration').map(block => <p key={block.blockId}>{block.text}</p>)}</article>)}<button onClick={() => setSource(null)}>关闭来源</button></MemoryDialog>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
