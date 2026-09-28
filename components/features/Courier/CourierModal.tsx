import { CLIP_ITEM, CLIP_SECTION } from '@/styles/clipPaths';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CourierContact, CourierMessage, CourierSystem } from '@/models/teyvat/courier';
import type { NPC记录 } from '@/models/npc';
import { 读取NPC头像 } from '@/models/npc';
import type { 相册系统 } from '@/models/imageGeneration';
import { appendCourierMessage, calculateCourierUnread, canAddNpcToCourierContacts, dissolveCourierGroupConversation, updateCourierGroupConversation } from '@/services/ai/courierService';
import { 解析相册资源引用 } from '@/utils/albumActions';
import { getDefaultBuiltinAvatar } from '@/data/builtinAvatars';
import { useModalAccessibility } from '@/components/ui/Modal';
import { pushToast } from '@/utils/toastStore';
import { CourierConversationList } from './CourierConversationList';
import { CourierMessageTimeline } from './CourierMessageTimeline';
import { CourierContactTools } from './CourierContactTools';
import { CourierMomentsPanel } from './CourierMomentsPanel';
import { countEligibleMomentCommenters, createMoment, deleteMoment, editMoment, restoreMoment } from '@/services/courierMoments';
import { createCourierPlayerMessageId } from '@/utils/courierReplyBatch';
import { displayCourierContactName } from '@/services/courierContactRemark';

export interface CourierModalProps {
  courier: CourierSystem;
  album?: 相册系统;
  npcRecords?: NPC记录[];
  travelerName?: string;
  travelerAvatar?: string;
  /** 当前主叙事回合；用于把本次手机消息与上一主回合可靠分隔。 */
  currentTurn?: number;
  onCourierChange: (update: CourierSystem | ((previous: CourierSystem) => CourierSystem)) => void;
  /** 玩家发送后请求回信；第二个参数是刚提交的玩家消息 ID。 */
  onRequestReply?: (conversationId: string, messageId: string) => void;
  replyErrorByConversationId?: Record<string, string>;
  onRetryReply?: (conversationId: string) => void;
  getGameSessionId?: () => number;
  onRequestMomentComments?: (postId: string, revision: number, npcId?: string) => void;
  canGenerateMomentComments?: boolean;
  onClose: () => void;
}

type ConversationFilter = 'all' | 'private' | 'group' | 'system';
type MobileView = 'list' | 'chat';
const INITIAL_VISIBLE_MESSAGES = 80;
const VISIBLE_MESSAGE_INCREMENT = 80;
const INITIAL_VISIBLE_CONVERSATIONS = 60;
/** 解散群聊的撤销窗口；比普通 toast 长，避免玩家来不及反应。 */
const UNDO_WINDOW_MS = 9000;

const gold = 'rgb(var(--tj-accent-primary))';
const goldSoft = (alpha: number) => `rgba(var(--tj-accent-primary), ${alpha})`;
const ink = (alpha: number) => `rgba(var(--tj-text-primary), ${alpha})`;
const muted = (alpha: number) => `rgba(var(--tj-text-secondary), ${alpha})`;


export function resolveCourierMessageTurn(currentTurn: number, messages: Array<Pick<CourierMessage, 'turn'>>): number {
  return Math.max(currentTurn, 0, ...messages.map((message) => message.turn));
}

function formatWallTime(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export const CourierModal = memo(function CourierModal({ courier, album, npcRecords = [], travelerName, travelerAvatar, currentTurn = 0, onCourierChange, onRequestReply, replyErrorByConversationId, onRetryReply, getGameSessionId, onRequestMomentComments, canGenerateMomentComments = false, onClose }: CourierModalProps) {
  const [selectedId, setSelectedId] = useState(courier.conversations[0]?.id ?? '');
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [mobileView, setMobileView] = useState<MobileView>('list');
  const [phoneSection, setPhoneSection] = useState<'chats' | 'moments'>('chats');
  const [showGroupEditor, setShowGroupEditor] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupMemberIds, setEditGroupMemberIds] = useState<string[]>([]);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [visibleConversationCount, setVisibleConversationCount] = useState(INITIAL_VISIBLE_CONVERSATIONS);
  const dialogRef = useModalAccessibility<HTMLElement>(onClose);
  const messageBottomRef = useRef<HTMLDivElement>(null);

  const npcById = useMemo(() => {
    const map = new Map<string, NPC记录>();
    for (const record of npcRecords) map.set(record.id, record);
    return map;
  }, [npcRecords]);
  const eligibleMomentCommenterCount = useMemo(
    () => countEligibleMomentCommenters(courier.contacts, npcRecords),
    [courier.contacts, npcRecords],
  );
  const momentCommenterNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const contact of courier.contacts) if (contact.npcId) names.set(contact.npcId, contact.name);
    for (const npc of npcRecords) names.set(npc.id, npc.姓名);
    return names;
  }, [courier.contacts, npcRecords]);

  const resolveAlbumValue = useMemo(() => {
    const cache = new Map<string, string | undefined>();
    return (value: string | undefined): string | undefined => {
      if (!value) return undefined;
      if (cache.has(value)) return cache.get(value);
      const resolved = 解析相册资源引用(album, value) || undefined;
      cache.set(value, resolved);
      return resolved;
    };
  }, [album]);

  const conversations = useMemo(() => {
    const filtered = courier.conversations.filter((conversation) => filter === 'all' || conversation.type === filter);
    return filtered.sort((left, right) => {
      if (Boolean(right.pinned) !== Boolean(left.pinned)) return Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
      return right.updatedAt - left.updatedAt;
    });
  }, [courier.conversations, filter]);

  const visibleConversations = useMemo(
    () => conversations.slice(0, visibleConversationCount),
    [conversations, visibleConversationCount],
  );
  const hiddenConversationCount = Math.max(0, conversations.length - visibleConversations.length);

  const handleSelectConversation = useCallback((conversationId: string) => {
    setSelectedId(conversationId);
    setPhoneSection('chats');
    setMobileView('chat');
  }, []);
  const handleShowMoreConversations = useCallback(() => {
    setVisibleConversationCount((count) => count + INITIAL_VISIBLE_CONVERSATIONS);
  }, []);

  useEffect(() => {
    setVisibleConversationCount(INITIAL_VISIBLE_CONVERSATIONS);
  }, [filter]);

  const selected = conversations.find((conversation) => conversation.id === selectedId)
    ?? courier.conversations.find((conversation) => conversation.id === selectedId)
    ?? conversations[0]
    ?? null;

  const contactNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const contact of courier.contacts) map.set(contact.id, contact.name);
    return map;
  }, [courier.contacts]);

  const displayTitleByConversationId = useMemo(() => {
    const overrides = new Map<string, string>();
    const remarkedContacts = courier.contacts.filter((contact) => Boolean(contact.remark?.trim()));
    if (!remarkedContacts.length) return overrides;
    for (const conversation of courier.conversations) {
      if (conversation.type !== 'private') continue;
      const contact = remarkedContacts.find((item) => conversation.participantIds.includes(item.id)
        || Boolean(item.npcId && conversation.participantIds.includes(item.npcId)));
      if (contact) overrides.set(conversation.id, displayCourierContactName(contact));
    }
    return overrides;
  }, [courier.conversations, courier.contacts]);

  const contactByParticipantId = useMemo(() => {
    const map = new Map<string, CourierContact>();
    for (const contact of courier.contacts) {
      map.set(contact.id, contact);
      if (contact.npcId) map.set(contact.npcId, contact);
    }
    return map;
  }, [courier.contacts]);

  const visibleMessages = useMemo(
    () => selected?.messages.slice(-visibleMessageCount) ?? [],
    [selected?.messages, visibleMessageCount],
  );
  const hiddenMessageCount = Math.max(0, (selected?.messages.length ?? 0) - visibleMessages.length);
  const conversationWallpaper = courier.wallpapers.conversation
    ? resolveAlbumValue(courier.wallpapers.conversation) ?? courier.wallpapers.conversation
    : undefined;

  useEffect(() => {
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
  }, [selected?.id]);
  const handleShowEarlierMessages = useCallback(() => {
    setVisibleMessageCount((count) => count + VISIBLE_MESSAGE_INCREMENT);
  }, []);

  const contactIdForParticipant = (participantId: string): string | undefined =>
    contactByParticipantId.get(participantId)?.id;

  useLayoutEffect(() => {
    if (!selected || mobileView !== 'chat') return;
    messageBottomRef.current?.scrollIntoView({ block: 'end' });
  }, [selected, mobileView]);

  const commit = (update: CourierSystem | ((previous: CourierSystem) => CourierSystem)) => {
    onCourierChange((previous) => {
      const next = typeof update === 'function' ? update(previous) : update;
      return { ...next, unreadTotal: calculateCourierUnread({ conversations: next.conversations, deliverySeeds: next.deliverySeeds }) };
    });
  };

  const markConversationRead = (conversationId: string) => {
    commit((previous) => ({
      ...previous,
      conversations: previous.conversations.map((conversation) => conversation.id === conversationId ? { ...conversation, unread: 0 } : conversation),
    }));
  };

  // 打开会话即已读（未读为 0 时不动状态，避免无谓的提交）。
  useEffect(() => {
    if (selected?.unread) markConversationRead(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.unread]);

  const eligibleNpcContacts = useMemo(() => {
    const knownNpcIds = new Set(courier.contacts.flatMap((contact) => contact.npcId?.trim() || []));
    const knownNames = new Set(courier.contacts.map((contact) => contact.name.trim()));
    return npcRecords.filter((npc) => canAddNpcToCourierContacts(npc)
      && !knownNpcIds.has(npc.id)
      && !knownNames.has(npc.姓名.trim()));
  }, [courier.contacts, npcRecords]);

  const togglePinned = (conversationId: string) => {
    commit((previous) => ({
      ...previous,
      conversations: previous.conversations.map((conversation) => conversation.id === conversationId ? { ...conversation, pinned: !conversation.pinned } : conversation),
    }));
  };

  const openGroupEditor = () => {
    if (!selected || selected.type !== 'group') return;
    setEditGroupName(selected.title);
    setEditGroupMemberIds(selected.participantIds.flatMap((id) => contactIdForParticipant(id) ?? []));
    setShowGroupEditor(true);
  };

  const saveGroupEditor = () => {
    if (!selected || selected.type !== 'group') return;
    commit((previous) => updateCourierGroupConversation(previous, selected.id, {
      title: editGroupName,
      memberIds: editGroupMemberIds,
    }));
    setShowGroupEditor(false);
  };

  const dissolveSelectedGroup = () => {
    if (!selected || selected.type !== 'group') return;
    const group = selected;
    const originalIndex = courier.conversations.findIndex((conversation) => conversation.id === group.id);
    const removedSeeds = courier.deliverySeeds.filter((seed) => seed.targetId === group.id);
    const actionSessionId = getGameSessionId?.();
    const dissolvedTitle = selected.title || '未命名群聊';
    const nextSelectedId = courier.conversations.find((conversation) => conversation.id !== selected.id)?.id ?? '';
    commit((previous) => dissolveCourierGroupConversation(previous, selected.id));
    setShowGroupEditor(false);
    setSelectedId(nextSelectedId);
    setMobileView('list');
    pushToast({
      kind: 'info',
      title: `已解散「${dissolvedTitle}」`,
      detail: '群聊记录已移除，联系人与私聊保留。点「撤销」可以恢复。',
      durationMs: UNDO_WINDOW_MS,
      action: {
        label: '撤销',
        run: () => {
          if (getGameSessionId && getGameSessionId() !== actionSessionId) return;
          onCourierChange((current) => {
            if (current.conversations.some((conversation) => conversation.id === group.id)) return current;
            const conversations = [...current.conversations];
            conversations.splice(Math.min(originalIndex, conversations.length), 0, group);
            const existingSeedIds = new Set(current.deliverySeeds.map((seed) => seed.id));
            const deliverySeeds = [...current.deliverySeeds, ...removedSeeds.filter((seed) => !existingSeedIds.has(seed.id))];
            return { ...current, conversations, deliverySeeds, unreadTotal: calculateCourierUnread({ conversations, deliverySeeds }) };
          });
          setSelectedId(selected.id);
          setMobileView('chat');
        },
      },
    });
  };

  const sendMessage = () => {
    const content = draft.trim();
    if (!selected || !content || selected.type === 'system') return;
    const timestamp = Date.now();
    const messageId = createCourierPlayerMessageId();
    onCourierChange((previous) => {
      const next = appendCourierMessage(previous, selected.id, {
        id: messageId,
        senderId: 'player',
        senderName: travelerName?.trim() || '旅人',
        role: 'user',
        content,
        turn: resolveCourierMessageTurn(currentTurn, selected.messages),
        timestamp,
        readBy: ['player'],
      });
      const nextConversations = next.conversations.map((conversation) => conversation.id === selected.id
        ? { ...conversation, unread: conversation.unread > 0 ? conversation.unread - 1 : 0, updatedAt: timestamp }
        : conversation);
      return { ...next, conversations: nextConversations, unreadTotal: calculateCourierUnread({ conversations: nextConversations, deliverySeeds: next.deliverySeeds }) };
    });
    setDraft('');
    // 即时回复：玩家一发送就触发生成，不用等下一回合。
    onRequestReply?.(selected.id, messageId);
  };

  const resolveSenderAvatar = useCallback((message: CourierMessage): string | undefined => {
    if (message.senderId === 'player' && travelerAvatar?.trim()) {
      return resolveAlbumValue(travelerAvatar) || travelerAvatar;
    }
    const fromMessage = message.avatar?.trim();
    if (fromMessage) return resolveAlbumValue(fromMessage);
    const contact = contactByParticipantId.get(message.senderId);
    const npcId = contact?.npcId?.trim();
    const npc = npcId ? npcById.get(npcId) : undefined;
    const resolved = contact?.avatar || 读取NPC头像(npc, '手机') || 读取NPC头像(npc, '正文') || 读取NPC头像(npc, '档案') || getDefaultBuiltinAvatar(contact?.name || message.senderName);
    return resolved ? resolveAlbumValue(resolved) || resolved : undefined;
  }, [contactByParticipantId, npcById, resolveAlbumValue, travelerAvatar]);
  const memberName = (participantId: string): string => {
    if (participantId === 'player') return travelerName?.trim() || '旅人';
    const contact = contactByParticipantId.get(participantId);
    if (contact) return contact.name;
    return npcById.get(participantId)?.姓名 ?? participantId;
  };

  const filters: Array<{ id: ConversationFilter; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'private', label: '私聊' },
    { id: 'group', label: '群组' },
    { id: 'system', label: '系统' },
  ];

  const publishMoment = (content: string) => {
    if ((courier.moments?.length ?? 0) >= 500) {
      pushToast({ kind: 'info', title: '朋友圈已满', detail: '最多保存 500 条动态；删除旧动态后可继续发布。' });
      return false;
    }
    const id = `moment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    commit((previous) => (previous.moments?.length ?? 0) >= 500 ? previous : createMoment(previous, { id, content, turn: currentTurn, now }));
    onRequestMomentComments?.(id, 1);
    return true;
  };
  const reviseMoment = (id: string, content: string) => {
    const post = courier.moments?.find((item) => item.id === id);
    if (!post) return;
    commit((previous) => editMoment(previous, id, content, Date.now()));
    onRequestMomentComments?.(id, post.revision + 1);
  };
  const removeMoment = (id: string) => {
    const post = courier.moments?.find((item) => item.id === id);
    if (!post) return;
    const actionSessionId = getGameSessionId?.();
    commit((previous) => deleteMoment(previous, id));
    pushToast({
      kind: 'info', title: '动态已删除', detail: '可在短时间内撤销。', durationMs: UNDO_WINDOW_MS,
      action: { label: '撤销', run: () => {
        if (getGameSessionId && getGameSessionId() !== actionSessionId) return;
        commit((previous) => restoreMoment(previous, post));
      } },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 sm:p-4">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="提瓦特手机"
        tabIndex={-1}
        className="journal-story-page grid h-[100dvh] w-full grid-cols-1 overflow-hidden text-[rgb(var(--tj-text-primary))] sm:h-[min(84vh,720px)] sm:w-[min(980px,100%)] sm:grid-cols-[minmax(220px,30%)_1fr]"
        style={{
          background: 'linear-gradient(180deg, var(--journal-parchment), color-mix(in srgb, var(--journal-parchment) 86%, var(--journal-leather) 14%))',
          boxShadow: `inset 0 0 0 1px ${goldSoft(0.35)}, 0 24px 60px rgba(0, 0, 0, 0.5)`,
          clipPath: CLIP_SECTION,
          ...(courier.wallpapers.home ? { backgroundImage: `linear-gradient(rgba(239, 227, 201, 0.86), rgba(239, 227, 201, 0.92)), url(${resolveAlbumValue(courier.wallpapers.home) ?? courier.wallpapers.home})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
        }}
      >
        {/* ── 会话列表 ── */}
        <aside className={`min-h-0 flex-col border-r border-[rgba(var(--tj-accent-primary),0.2)] ${mobileView === 'list' ? 'flex' : 'hidden sm:flex'}`}>
          <header className="flex items-center justify-between px-4 pb-2 pt-4">
            <div>
              <p className="text-[10px] tracking-[0.3em]" style={{ color: gold }}>COURIER</p>
              <h2 className="font-serif text-lg tracking-[0.14em]">提瓦特手机</h2>
            </div>
            {courier.unreadTotal > 0 && (
              <span className="px-2 py-0.5 text-[11px]" style={{ color: 'rgb(var(--tj-on-accent))', background: goldSoft(0.85), clipPath: CLIP_ITEM }}>
                未读 {courier.unreadTotal}
              </span>
            )}
          </header>
          <div className="flex gap-1 px-3 pb-2">
            <button type="button" onClick={() => { setPhoneSection('moments'); setMobileView('chat'); }}
              className="min-h-11 px-3 text-xs tracking-[0.1em]"
              style={{ color: phoneSection === 'moments' ? 'rgb(var(--tj-on-accent))' : muted(0.9), background: phoneSection === 'moments' ? goldSoft(0.8) : goldSoft(0.08), clipPath: CLIP_ITEM }}>
              朋友圈
            </button>
          </div>
          <div className="flex gap-1 px-3 pb-2">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className="px-2 py-1 text-[11px] tracking-[0.12em] transition-colors"
                style={{
                  color: filter === item.id ? 'rgb(var(--tj-on-accent))' : muted(0.85),
                  background: filter === item.id ? goldSoft(0.8) : goldSoft(0.06),
                  clipPath: CLIP_ITEM,
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <CourierContactTools
            courier={courier}
            eligibleNpcContacts={eligibleNpcContacts}
            onCourierChange={onCourierChange}
            onOpenConversation={handleSelectConversation}
          />
          <CourierConversationList
            conversations={visibleConversations}
            displayTitleByConversationId={displayTitleByConversationId}
            selectedId={selected?.id}
            hiddenConversationCount={hiddenConversationCount}
            onSelect={handleSelectConversation}
            onShowMore={handleShowMoreConversations}
          />
        </aside>

        {/* ── 会话视图 ── */}
        <main className={`min-h-0 flex-col ${mobileView === 'chat' ? 'flex' : 'hidden sm:flex'}`}>
          <header className="flex items-center justify-between gap-3 border-b border-[rgba(var(--tj-accent-primary),0.2)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileView('list')}
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center px-2 py-1 text-xs sm:hidden"
                style={{ color: goldSoft(0.9), boxShadow: `inset 0 0 0 1px ${goldSoft(0.35)}` }}
                aria-label="返回会话列表"
              >
                ←
              </button>
              <div className="min-w-0">
                <h3 className="truncate font-serif text-lg tracking-wide">{phoneSection === 'moments' ? '朋友圈' : selected ? displayTitleByConversationId.get(selected.id) ?? selected.title : '消息'}</h3>
                {phoneSection === 'chats' && selected?.type === 'group' && (
                  <p className="break-words text-[12px]" style={{ color: muted(0.75) }}>
                    {selected.participantIds.map(memberName).join('、')}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
               {phoneSection === 'chats' && selected && (
                 selected.type === 'group' && (
                   <button
                     type="button"
                     onClick={openGroupEditor}
                     aria-label="群聊设置"
                     className="px-2 py-1 text-[11px]"
                     style={{ color: muted(0.85), boxShadow: `inset 0 0 0 1px ${goldSoft(0.25)}`, clipPath: CLIP_ITEM }}
                   >
                     群聊设置
                   </button>
                 )
               )}
               {phoneSection === 'chats' && selected && (
                 <button
                  type="button"
                  onClick={() => togglePinned(selected.id)}
                  className="px-2 py-1 text-[11px]"
                  style={{ color: muted(0.85), boxShadow: `inset 0 0 0 1px ${goldSoft(0.25)}`, clipPath: CLIP_ITEM }}
                >
                  {selected.pinned ? '取消置顶' : '置顶'}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭手机"
                className="flex h-9 w-9 items-center justify-center text-base"
                style={{ color: ink(0.85), boxShadow: `inset 0 0 0 1px ${goldSoft(0.3)}`, clipPath: CLIP_ITEM }}
              >
                ✕
              </button>
            </div>
          </header>

           {phoneSection === 'moments' && (
             <CourierMomentsPanel
               moments={courier.moments ?? []} travelerName={travelerName ?? '旅行者'}
               eligibleCommenterCount={eligibleMomentCommenterCount} canGenerateComments={canGenerateMomentComments}
               commenterNames={momentCommenterNames}
               onPublish={publishMoment} onEdit={reviseMoment} onDelete={removeMoment}
               onRetry={(id, revision, npcId) => onRequestMomentComments?.(id, revision, npcId)}
             />
           )}
           <div className={`min-h-0 flex-1 flex-col ${phoneSection === 'moments' ? 'hidden' : 'flex'}`}>
           {selected?.announcement && (
            <p className="border-b border-[rgba(var(--tj-accent-primary),0.14)] px-4 py-2 text-[12px] leading-5" style={{ color: goldSoft(0.9), background: goldSoft(0.05) }}>
              📜 群公告：{selected.announcement}
            </p>
           )}

           {showGroupEditor && selected?.type === 'group' && (
             <section className="border-b border-[rgba(var(--tj-accent-primary),0.2)] px-4 py-3" aria-label="编辑群聊">
               <input
                 value={editGroupName}
                 onChange={(event) => setEditGroupName(event.target.value)}
                 aria-label="修改群聊名称"
                 className="mb-2 w-full px-2 py-1.5 text-sm"
                 style={{ background: 'rgba(255,252,240,0.72)', boxShadow: `inset 0 0 0 1px ${goldSoft(0.3)}` }}
               />
               <div className="mb-2 flex max-h-24 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
                 {courier.contacts.map((contact) => (
                   <label key={contact.id} className="flex items-center gap-1 text-[11px]">
                     <input
                       type="checkbox"
                       checked={editGroupMemberIds.includes(contact.id)}
                       onChange={() => setEditGroupMemberIds((current) => current.includes(contact.id) ? current.filter((id) => id !== contact.id) : [...current, contact.id])}
                     />
                     {contact.name}
                   </label>
                 ))}
               </div>
               <div className="flex items-center justify-between gap-2">
                 <button
                   type="button"
                   onClick={dissolveSelectedGroup}
                   aria-label="解散群聊"
                   className="px-2 py-1 text-[11px]"
                   style={{ color: 'rgba(var(--tj-danger),0.95)', boxShadow: 'inset 0 0 0 1px rgba(var(--tj-danger),0.35)' }}
                 >
                   解散群聊
                 </button>
                 <div className="flex justify-end gap-2">
                 <button type="button" onClick={() => setShowGroupEditor(false)} className="px-2 py-1 text-[11px]">取消</button>
                 <button type="button" onClick={saveGroupEditor} disabled={!editGroupMemberIds.length} className="teyvat-btn teyvat-btn-primary px-3 py-1 text-[11px] disabled:opacity-40">保存</button>
                 </div>
               </div>
             </section>
           )}

          <CourierMessageTimeline
            selected={selected}
            visibleMessages={visibleMessages}
            hiddenMessageCount={hiddenMessageCount}
            conversationWallpaper={conversationWallpaper}
            contactNameById={contactNameById}
            messageBottomRef={messageBottomRef}
            resolveSenderAvatar={resolveSenderAvatar}
            onShowEarlier={handleShowEarlierMessages}
          />

          {selected && replyErrorByConversationId?.[selected.id] && (
            <div role="alert" className="mx-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs" style={{ color: ink(0.92), background: 'rgba(160,63,52,0.12)', clipPath: CLIP_ITEM }}>
              <span>回信失败，消息已保留。{replyErrorByConversationId[selected.id] === 'api_unavailable' ? '请检查手机或主模型 API 设置。' : '请稍后重试。'}</span>
              <button type="button" className="min-h-11 px-3 underline" onClick={() => onRetryReply?.(selected.id)}>重试回信</button>
            </div>
          )}

          {selected && selected.type !== 'system' ? (
            <div className="flex items-end gap-2 border-t border-[rgba(var(--tj-accent-primary),0.2)] p-3">
              <div className="min-w-0 flex-1">
                {selected.type === 'group' && (
                  <div className="mb-1.5 flex flex-wrap gap-1" aria-label="@群成员">
                    <button
                      type="button"
                      onClick={() => setDraft((value) => `${value}${value && !/\s$/u.test(value) ? ' ' : ''}@全体成员 `)}
                      className="px-2 py-0.5 text-[10px]"
                      style={{ color: 'rgba(69,56,42,0.94)', background: goldSoft(0.16), boxShadow: `inset 0 0 0 1px ${goldSoft(0.42)}` }}
                    >
                      @全体成员
                    </button>
                    {selected.participantIds.filter((id) => id !== 'player').map((id) => (
                      <button key={id} type="button" onClick={() => setDraft((value) => `${value}${value && !/\s$/u.test(value) ? ' ' : ''}@${memberName(id)} `)} className="px-2 py-0.5 text-[10px]" style={{ color: 'rgba(69,56,42,0.9)', background: goldSoft(0.1), boxShadow: `inset 0 0 0 1px ${goldSoft(0.28)}` }}>@{memberName(id)}</button>
                    ))}
                  </div>
                )}
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || event.key !== 'Enter' || event.shiftKey) return;
                    event.preventDefault();
                    sendMessage();
                  }}
                  className="min-h-[44px] max-h-28 w-full resize-none px-3 py-2 text-sm"
                  style={{ background: 'rgba(53,46,39,0.06)', color: ink(0.96), boxShadow: `inset 0 0 0 1px ${goldSoft(0.3)}`, clipPath: CLIP_ITEM }}
                  placeholder={`发消息给 ${selected.title}……`}
                  aria-label="手机回复"
                />
                <p className="mt-1 px-1 text-[10px] tracking-[0.08em]" style={{ color: muted(0.7) }}>Enter 发送 · Shift+Enter 换行</p>
              </div>
              <button
                type="button"
                onClick={sendMessage}
                disabled={!draft.trim()}
                className="teyvat-btn teyvat-btn-primary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="relative">发送</span>
              </button>
            </div>
          ) : selected ? (
            <p className="border-t border-[rgba(var(--tj-accent-primary),0.2)] px-4 py-2.5 text-center text-[11px] tracking-[0.2em]" style={{ color: muted(0.65) }}>
              系统通知为只读会话
            </p>
          ) : null}
          </div>
        </main>
      </section>
    </div>
  );
});
