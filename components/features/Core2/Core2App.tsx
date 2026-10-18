import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { CoreController } from '@/core/settlement/coreController';
import type { CoreRepository } from '@/core/contracts/storage';
import { CoreOpeningForm } from './CoreOpeningForm';
import './core2.css';
import { CoreReviewPanel } from './CoreReviewPanel';
import { CORE_WORKSPACES, CoreWorkspaceOutlet, type CoreWorkspace } from './CoreWorkspaceOutlet';
import { CoreJourneySwitcher } from './CoreJourneySwitcher';

export function Core2App({ controller, repo }: { controller: CoreController; repo: CoreRepository }) {
  const view = useSyncExternalStore(controller.subscribe, controller.getView, controller.getView);
  const [input, setInput] = useState(''), [localError, setLocalError] = useState('');
  const [page, setPage] = useState<CoreWorkspace>('adventure');
  const end = useRef<HTMLDivElement>(null), nearBottom = useRef(true), [unseen, setUnseen] = useState(false);
  const snapshot = view.snapshot, world = snapshot?.records.find(row => row.domain === 'world')?.value;
  const player = snapshot?.records.find(row => row.domain === 'traveler')?.value;
  useEffect(() => { setInput(''); setPage('adventure'); setUnseen(false); nearBottom.current = true; }, [snapshot?.head.scope.journeyId, snapshot?.head.scope.branchId]);
  const run = (work: () => Promise<unknown>) => { setLocalError(''); void work().catch(error => setLocalError(error instanceof Error ? error.message : String(error))); };
  useEffect(() => { if (nearBottom.current) end.current?.scrollIntoView?.({ block: 'end' }); else setUnseen(true); }, [view.messages]);
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!snapshot || !input.trim() || view.busy || view.readOnly || view.pendingOperationId) return;
    const text = input, owner = snapshot.head;
    setInput(''); nearBottom.current = true;
    const restoreUnsaved = () => {
      const current = controller.getView().snapshot?.head;
      if (current?.sessionId === owner.sessionId && current.scope.journeyId === owner.scope.journeyId && current.scope.branchId === owner.scope.branchId) setInput(draft => draft || text);
    };
    run(async () => {
      try {
        const result = await controller.send({ scope: owner.scope, sessionId: owner.sessionId, operationId: crypto.randomUUID(), text });
        if (result.kind === 'failed' && !controller.getView().pendingOperationId) restoreUnsaved();
      } catch (error) { restoreUnsaved(); throw error; }
    });
  };
  return <main className="core2-shell journal-paper-surface">
    <header className="core2-heading journal-leather-surface"><div><small>提瓦特轶事 · 新内核试用</small><h1>旅人的冒险手账</h1></div><span>独立新档 · 不读取旧存档</span></header>
    <CoreJourneySwitcher key={snapshot?.head.sessionId ?? 'no-journey'} controller={controller} repo={repo} disabled={view.busy || view.readOnly} hasJourney={!!snapshot} />
    {!snapshot ? <CoreOpeningForm onStart={seed => controller.initialize(seed)} /> : <>
      <section className="core2-toolbar" aria-label="旅程状态"><span>{player?.姓名} · 第 {world?.completedMainTurns ?? 0} 回合</span><span>{world?.moment.date} {world?.moment.clock} · {world?.moment.weather} · {world?.moment.location}</span><div><button disabled={view.busy || view.readOnly} onClick={() => run(() => controller.save({ scope: snapshot.head.scope, kind: 'manual', asNew: false, turn: world?.completedMainTurns ?? 0, name: player?.姓名 ?? '旅人' }))}>保存</button><button disabled={view.busy || view.readOnly} onClick={() => run(() => controller.save({ scope: snapshot.head.scope, kind: 'manual', asNew: true, turn: world?.completedMainTurns ?? 0, name: player?.姓名 ?? '旅人' }))}>另存为新节点</button></div><small data-save-status>{view.lastSaved ? '已保存到手动档' : '尚未手动保存'}</small></section>
      <p className="core2-story-caption">当前篇章：{controller.getCurrentStoryTitle()}</p>
      <nav className="core2-workspace-tabs" aria-label="手账页面">{(Object.keys(CORE_WORKSPACES) as CoreWorkspace[]).map(key => <button key={key} aria-pressed={page === key} onClick={() => setPage(key)}>{CORE_WORKSPACES[key]}</button>)}</nav>
      {page === 'adventure' ? <><section className="core2-conversation" aria-label="冒险对话" onScroll={event => { const el = event.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; if (nearBottom.current) setUnseen(false); }}>
        {!view.messages.length && <p className="core2-empty">蒙德的风翻开新的一页。写下你想做的事吧。</p>}
        {view.messages.map(message => <article key={message.id} data-chat-role={message.role} className={`core2-message ${message.role}`}><div className="core2-avatar" aria-hidden="true">{message.role === 'user' ? player?.姓名.slice(0, 1) : '叙'}</div><div><strong>{message.role === 'user' ? player?.姓名 : '旅途记录'}</strong>{message.source.blocks.map(block => <p key={block.blockId}>{block.text}</p>)}{message.status === 'pending' && <small>正文已保留 · 其中待核对的内容尚不算已确认事实</small>}</div></article>)}<div ref={end} />
      </section>
      {unseen && <button onClick={() => { end.current?.scrollIntoView?.({ block: 'end' }); nearBottom.current = true; setUnseen(false); }}>有新消息，跳到最新</button>}
      <form className="core2-compose" onSubmit={send}><label className="core2-input-label" htmlFor="core2-input">这一页，写下你的选择</label><textarea id="core2-input" value={input} onChange={event => setInput(event.target.value)} disabled={view.readOnly} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button type="submit" disabled={view.busy || view.readOnly || !!view.pendingOperationId || !input.trim()}>发送</button><small>Enter 发送 · Shift + Enter 换行</small></form>
      {view.busy && view.pendingOperationId && <button onClick={() => run(() => controller.cancel(view.pendingOperationId!))}>停止本回合</button>}
      {!view.busy && view.pendingOperationId && <button onClick={() => run(() => controller.retry(view.pendingOperationId!))}>重试本回合（沿用已保存正文）</button>}
      {view.result?.kind === 'committed' && <p role="status">本回合已结算并保存。</p>}
      {(view.receipt || view.pendingReviews.length > 0) && <CoreReviewPanel receipt={view.receipt} pending={view.pendingReviews} busy={view.busy || view.readOnly} onReview={async (operationId, candidate, decision) => { try { await controller.review(operationId, candidate, decision); } catch { /* Controller exposes sanitized failures. */ } }} />}</> : <CoreWorkspaceOutlet key={`${snapshot.head.scope.journeyId}:${snapshot.head.scope.branchId}:${page}`} page={page} repo={repo} controller={controller} snapshot={snapshot} revision={view.jobRevision} disabled={view.busy || view.readOnly} />}
      {view.slots.length > 0 && <details className="core2-card"><summary>手账存档（读取会建立独立分支）</summary>{view.slots.map(slot => <button disabled={view.busy} key={slot.slotId} onClick={() => run(() => controller.restore(slot.snapshotId))}>{slot.name} · 第 {slot.turn} 回合</button>)}</details>}
    </>}
    {view.autoSaveError && <section className="core2-error" role="alert"><p>{view.autoSaveError}</p><button disabled={view.busy || view.readOnly} onClick={() => run(() => controller.saveAutomatic())}>重试自动存档</button></section>}
    {(view.error || localError) && <p className="core2-error" role="alert">{view.error || localError}</p>}
  </main>;
}
