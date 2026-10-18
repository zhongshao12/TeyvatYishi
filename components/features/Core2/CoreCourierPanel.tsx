import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CoreRepository } from '@/core/contracts/storage';
import type { CoreSnapshot } from '@/core/contracts/state';
import type { GameEvent } from '@/core/contracts/event';
import { useCore2Query } from '@/hooks/useCore2Query';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { compareCoreIds } from '@/core/persistence/repositoryValidation';
import { CoreAvatar, coreCourierName } from './CoreAvatar';
import { CourierUnreadBadge } from '@/components/features/Courier/CourierAvatar';
import '@/styles/journal-phone.css';
import type { BasicPlayerCommand } from '@/core/settlement/actions';
import { CorePhoneManagement } from './CorePhoneManagement';
import { CoreMomentsPanel } from './CoreMomentsPanel';
import type { CoreController } from '@/core/settlement/coreController';
import { CorePhonePhotos } from './CorePhonePhotos';

interface PhoneProps { repo: CoreRepository; snapshot: CoreSnapshot; controller?: CoreController; onSend(conversationId: string, text: string): Promise<unknown>; onRead?(conversationId: string, expectedVersion: number, throughSeq: number): Promise<unknown>; onCommand?(command: BasicPlayerCommand): Promise<unknown>; onRetry?(id: string): Promise<unknown>; revision?: number; disabled?: boolean }
export function CoreCourierPanel({ repo, snapshot, controller, onSend, onRead, onCommand, onRetry, revision = 0, disabled = false }: PhoneProps) {
  const conversations = snapshot.records.flatMap(row => row.domain === 'courier' && row.value.kind === 'conversation' && !row.value.dissolved ? [{ id: row.entityId, version: row.version, ...row.value }] : []);
  const [selected, setSelected] = useState(''), [drafts, setDrafts] = useState<Record<string, string>>({});
  const [opened, setOpened] = useState('');
  const [tab, setTab] = useState<'chat' | 'moments'>('chat');
  const current = conversations.find(row => row.id === selected) ?? conversations[0];
  const identity = `${snapshot.head.scope.journeyId}:${snapshot.head.scope.branchId}:${snapshot.head.sessionId}`;
  return <section className="core2-card core2-phone" aria-label="手机"><header><h2>旅人的手机</h2></header>
    <nav className="core2-panel-actions" aria-label="手机页面"><button aria-pressed={tab === 'chat'} onClick={() => setTab('chat')}>聊天</button>{onCommand && <button aria-pressed={tab === 'moments'} onClick={() => setTab('moments')}>朋友圈</button>}</nav>
    {tab === 'moments' && onCommand ? <CoreMomentsPanel key={identity} {...{ repo, snapshot, revision, disabled, onCommand, onRetry, controller }} /> : <>
    {onCommand && <CorePhoneManagement repo={repo} snapshot={snapshot} currentId={current?.id} disabled={disabled} onCommand={onCommand} onOpen={id => { setSelected(id); setOpened(`${identity}:${id}`); }} />}
    <nav className="core2-phone-conversations" aria-label="手机对话列表">{conversations.map(conversation => <button key={conversation.id} data-core-conversation={conversation.id} aria-pressed={current?.id === conversation.id} onClick={() => { setSelected(conversation.id); setOpened(`${identity}:${conversation.id}`); }}>
      <span className="phone-conversation-portrait">{conversation.memberIds.length > 1 ? <span className="phone-group-avatar">{conversation.memberIds.slice(0, 4).map(id => <CoreAvatar key={id} repo={repo} snapshot={snapshot} entityId={id} small />)}</span> : <CoreAvatar repo={repo} snapshot={snapshot} entityId={conversation.memberIds[0]!} />}<CourierUnreadBadge count={conversation.unreadCount} /></span>
      <span><strong>{conversation.conversationType === 'private' ? coreCourierName(snapshot, conversation.memberIds[0]!) : conversation.name}</strong><small>{conversation.conversationType === 'group' ? `${conversation.memberIds.length}位成员` : '私聊'}</small></span>
    </button>)}</nav>
    {current?.conversationType === 'group' && <div className="core2-panel-actions" aria-label="提及群成员"><button disabled={disabled} onClick={() => setDrafts(before => ({ ...before, [`${identity}:${current.id}`]: `${before[`${identity}:${current.id}`] ?? ''}@全体成员 ` }))}>@全体成员</button>{current.memberIds.map(id => <button key={id} disabled={disabled} onClick={() => setDrafts(before => ({ ...before, [`${identity}:${current.id}`]: `${before[`${identity}:${current.id}`] ?? ''}@${coreCourierName(snapshot, id, false)} ` }))}>@{coreCourierName(snapshot, id)}</button>)}</div>}
    {current ? <CoreCourierThread key={`${identity}:${current.id}`} repo={repo} snapshot={snapshot} conversationId={current.id} draft={drafts[`${identity}:${current.id}`] ?? ''}
      setDraft={text => setDrafts(before => ({ ...before, [`${identity}:${current.id}`]: text }))} onSend={onSend} onRead={onRead} controller={controller} revision={revision} disabled={disabled} opened={opened === `${identity}:${current.id}`} /> : <p>还没有会话。先从已认识的同伴中添加联系人。</p>}
    </>}
  </section>;
}
function CoreCourierThread({ repo, snapshot, controller, conversationId, draft, setDraft, onSend, onRead, opened, revision = 0, disabled = false }: PhoneProps & { conversationId: string; draft: string; setDraft(text: string): void; opened: boolean }) {
  const view = useCore2Query({ kind: 'courier', head: snapshot.head, conversationId }, repo);
  const [messages, setMessages] = useState<GameEvent[]>([]), [unseen, setUnseen] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const seen = useRef(new Map<string, GameEvent>()), initial = useRef(true), timers = useRef<ReturnType<typeof setTimeout>[]>([]), nextDisplay = useRef(0);
  const scroll = useRef<HTMLDivElement>(null), nearBottom = useRef(true), geometry = useRef({ height: 0, top: 0, maxSeq: 0 });
  const player = snapshot.records.find(row => row.domain === 'traveler');
  const readAttempt = useRef('');
  const order = (a: GameEvent, b: GameEvent) => a.commitSeq - b.commitSeq || (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0) || compareCoreIds(a.eventId, b.eventId);
  useEffect(() => () => { timers.current.forEach(timer => clearTimeout(timer)); }, []);
  useEffect(() => {
    if (view.loading || !view.ready) return;
    const known = new Set(seen.current.keys()), newRows = view.items.filter(row => !known.has(row.eventId));
    newRows.forEach(row => seen.current.set(row.eventId, row));
    if (initial.current) { initial.current = false; setMessages([...seen.current.values()].sort(order)); return; }
    const latest = messages.reduce((seq, row) => Math.max(seq, row.commitSeq), 0);
    for (const row of newRows.sort(order)) {
      const reveal = () => { setMessages(before => [...before.filter(item => item.eventId !== row.eventId), row].sort(order)); if (row.commitSeq > latest && !nearBottom.current) setUnseen(value => value + 1); };
      // Reading older pages is immediate. Only newly arrived NPC lines are paced.
      if (row.commitSeq <= latest || player?.entityId === row.actorIds[0]) reveal();
      else { const now = Date.now(); nextDisplay.current = Math.max(now, nextDisplay.current) + 500; timers.current.push(setTimeout(reveal, nextDisplay.current - now)); }
    }
  // messages are only used as the stable previous delivery boundary, not a trigger for re-scheduling.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.items, view.loading, view.ready]);
  useLayoutEffect(() => {
    const element = scroll.current; if (!element) return;
    const maxSeq = messages.reduce((seq, row) => Math.max(seq, row.commitSeq), 0), old = geometry.current;
    if (nearBottom.current) element.scrollTop = element.scrollHeight;
    else if (maxSeq <= old.maxSeq) element.scrollTop = old.top + Math.max(0, element.scrollHeight - old.height);
    else element.scrollTop = old.top;
    geometry.current = { height: element.scrollHeight, top: element.scrollTop, maxSeq };
  }, [messages]);
  useEffect(() => {
    const channel = snapshot.records.find(row => row.domain === 'courier' && row.entityId === conversationId), latest = view.items.find(row => row.actorIds[0] !== player?.entityId);
    if (!opened || !onRead || !nearBottom.current || !view.ready || view.loading || channel?.domain !== 'courier' || channel.value.kind !== 'conversation' || !channel.value.unreadCount || !latest || !messages.some(row => row.eventId === latest.eventId)) return;
    const key = JSON.stringify([conversationId, channel.version, snapshot.head.coreSeq]); if (readAttempt.current === key) return; readAttempt.current = key;
    void onRead(conversationId, channel.version, snapshot.head.coreSeq).catch(failure => setError(sanitizeApiErrorReportText(String(failure))));
  }, [opened, onRead, conversationId, snapshot, messages, view.items, view.loading, view.ready, player?.entityId, unseen]);
  const label = (id: string) => coreCourierName(snapshot, id);
  const send = async () => { if (!draft.trim() || busy || disabled) return; setBusy(true); setError(''); try { await onSend(conversationId, draft); setDraft(''); nearBottom.current = true; } catch (failure) { setError(sanitizeApiErrorReportText(String(failure))); } finally { setBusy(false); } };
  return <><div className="core2-phone-messages" aria-label="手机消息" ref={scroll} onScroll={event => { const element = event.currentTarget; nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    geometry.current.top = element.scrollTop; geometry.current.height = element.scrollHeight; if (nearBottom.current) setUnseen(0); }}>
    {view.cursor && <button disabled={view.loading} onClick={() => void view.loadMore()}>读取更早消息</button>}
    {messages.map((message, index) => <article key={message.eventId} data-phone-message={message.eventId} className={`core2-phone-message ${message.actorIds[0] === player?.entityId ? 'player' : ''}`}>
      {index > 0 && messages[index - 1]!.turn !== message.turn && <div className="core2-phone-turn">第 {message.turn} 回合</div>}
      <CoreAvatar repo={repo} snapshot={snapshot} entityId={message.actorIds[0]!} /><div><strong>{label(message.actorIds[0]!)}</strong>{message.evidenceRefs.map((ref, i) => <p key={i}>{ref.quote}</p>)}</div></article>)}
  </div>{unseen > 0 && <button onClick={() => { nearBottom.current = true; setUnseen(0); if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }}>有 {unseen} 条新消息 · 跳到最新</button>}
    {view.loading && <p role="status">正在读取消息……</p>}{view.error && <p role="alert">{view.error}</p>}
    {controller && <CorePhonePhotos {...{ repo, controller, snapshot, conversationId, revision, disabled }} events={messages} shown={messages} />}
    <form className="core2-compose" onSubmit={event => { event.preventDefault(); void send(); }}><label htmlFor={`core2-phone-${conversationId}`}>写一条消息</label><textarea id={`core2-phone-${conversationId}`} disabled={disabled} value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
    }} /><button disabled={busy || disabled || !draft.trim()} type="submit">发送手机消息</button><small>Enter 发送 · Shift + Enter 换行</small></form>{error && <p role="alert">{error}</p>}
  </>;
}
