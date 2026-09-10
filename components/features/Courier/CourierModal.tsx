import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CourierContact, CourierConversation, CourierMessage, CourierSystem } from '@/models/teyvat/courier';
import type { NPC记录 } from '@/models/npc';
import { 读取NPC头像 } from '@/models/npc';
import type { 相册系统 } from '@/models/imageGeneration';
import { addNpcToCourierContacts, appendCourierMessage, calculateCourierUnread, canAddNpcToCourierContacts, updateCourierGroupConversation } from '@/services/ai/courierService';
import { 解析相册资源引用 } from '@/utils/albumActions';
import { getDefaultBuiltinAvatar } from '@/data/builtinAvatars';

export interface CourierModalProps {
  courier: CourierSystem;
  album?: 相册系统;
  npcRecords?: NPC记录[];
  travelerName?: string;
  travelerAvatar?: string;
  /** 当前主叙事回合；用于把本次手机消息与上一主回合可靠分隔。 */
  currentTurn?: number;
  onCourierChange: (next: CourierSystem) => void;
  /** 玩家发送后立即触发消息生成。参数：会话 id + 含玩家新消息的手机快照。 */
  onRequestReply?: (conversationId: string, courierSnapshot: CourierSystem) => void;
  onClose: () => void;
}

type ConversationFilter = 'all' | 'private' | 'group' | 'system';
type MobileView = 'list' | 'chat';

const gold = 'rgb(var(--tj-accent-primary))';
const goldSoft = (alpha: number) => `rgba(var(--tj-accent-primary), ${alpha})`;
const ink = (alpha: number) => `rgba(var(--tj-text-primary), ${alpha})`;
const muted = (alpha: number) => `rgba(var(--tj-text-secondary), ${alpha})`;
const clipSmall = 'polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px)';

const TYPE_LABELS: Record<CourierConversation['type'], string> = {
  private: '私聊',
  group: '群聊',
  system: '系统通知',
};

export function resolveCourierMessageTurn(currentTurn: number, messages: Array<Pick<CourierMessage, 'turn'>>): number {
  return Math.max(currentTurn, 0, ...messages.map((message) => message.turn));
}

function formatWallTime(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function CourierModal({ courier, album, npcRecords = [], travelerName, travelerAvatar, currentTurn = 0, onCourierChange, onRequestReply, onClose }: CourierModalProps) {
  const [selectedId, setSelectedId] = useState(courier.conversations[0]?.id ?? '');
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [mobileView, setMobileView] = useState<MobileView>('list');
  const [showContacts, setShowContacts] = useState(false);
  const [showGroupCreator, setShowGroupCreator] = useState(false);
  const [groupDraftName, setGroupDraftName] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [showGroupEditor, setShowGroupEditor] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupMemberIds, setEditGroupMemberIds] = useState<string[]>([]);
  const messageBottomRef = useRef<HTMLDivElement>(null);

  const npcById = useMemo(() => {
    const map = new Map<string, NPC记录>();
    for (const record of npcRecords) map.set(record.id, record);
    return map;
  }, [npcRecords]);

  const conversations = useMemo(() => {
    const filtered = courier.conversations.filter((conversation) => filter === 'all' || conversation.type === filter);
    return filtered.sort((left, right) => {
      if (Boolean(right.pinned) !== Boolean(left.pinned)) return Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
      return right.updatedAt - left.updatedAt;
    });
  }, [courier.conversations, filter]);

  const selected = conversations.find((conversation) => conversation.id === selectedId)
    ?? courier.conversations.find((conversation) => conversation.id === selectedId)
    ?? conversations[0]
    ?? null;

  const contactNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const contact of courier.contacts) map.set(contact.id, contact.name);
    return map;
  }, [courier.contacts]);

  const contactIdForParticipant = (participantId: string): string | undefined =>
    courier.contacts.find((contact) => contact.id === participantId || contact.npcId === participantId)?.id;

  useLayoutEffect(() => {
    if (!selected || mobileView !== 'chat') return;
    messageBottomRef.current?.scrollIntoView({ block: 'end' });
  }, [selected?.id, selected?.messages.length, selected?.updatedAt, selected?.typingMemberIds.length, mobileView]);

  const commit = (next: CourierSystem) => {
    onCourierChange({ ...next, unreadTotal: calculateCourierUnread({ conversations: next.conversations, deliverySeeds: next.deliverySeeds }) });
  };

  const markConversationRead = (conversationId: string) => {
    const target = courier.conversations.find((conversation) => conversation.id === conversationId);
    if (!target || !target.unread) return;
    commit({
      ...courier,
      conversations: courier.conversations.map((conversation) => conversation.id === conversationId ? { ...conversation, unread: 0 } : conversation),
    });
  };

  // 打开会话即已读（未读为 0 时不动状态，避免无谓的提交）。
  useEffect(() => {
    if (selected?.unread) markConversationRead(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.unread]);

  const eligibleNpcContacts = useMemo(() => npcRecords.filter((npc) => canAddNpcToCourierContacts(npc)
    && !courier.contacts.some((contact) => contact.npcId === npc.id || contact.name.trim() === npc.姓名.trim())), [courier.contacts, npcRecords]);

  /** 点击联系人立即进入已有私聊，或创建一个可直接发消息的空会话。 */
  const openContactConversation = (contact: CourierContact) => {
    const existing = courier.conversations.find((conversation) =>
      conversation.type === 'private' && conversation.participantIds.includes(contact.id));
    if (existing) {
      setSelectedId(existing.id);
      setMobileView('chat');
      setShowContacts(false);
      return;
    }
    const now = Date.now();
    const conversation: CourierConversation = {
      id: `courier_private_${contact.id}_${now}`,
      title: contact.name,
      participantIds: ['player', contact.id],
      messages: [],
      unread: 0,
      type: 'private',
      typingMemberIds: [],
      creatorId: 'player',
      updatedAt: now,
    };
    commit({ ...courier, conversations: [...courier.conversations, conversation] });
    setSelectedId(conversation.id);
    setMobileView('chat');
    setShowContacts(false);
  };

  const deleteContact = (contactId: string) => {
    commit({ ...courier, contacts: courier.contacts.filter((contact) => contact.id !== contactId) });
  };

  const toggleGroupMember = (contactId: string) => {
    setGroupMemberIds((current) => current.includes(contactId)
      ? current.filter((id) => id !== contactId)
      : [...current, contactId]);
  };

  // 组建群组：至少选 2 位联系人，创建群会话并跳转。群名缺省时用成员名拼接。
  const createGroup = () => {
    if (groupMemberIds.length < 2) return;
    const memberNames = groupMemberIds
      .map((id) => courier.contacts.find((contact) => contact.id === id)?.name?.trim())
      .filter((name): name is string => Boolean(name));
    const title = groupDraftName.trim() || memberNames.join('、');
    if (!title) return;
    const now = Date.now();
    const groupConversation: CourierConversation = {
      id: `courier_group_${now}`,
      title,
      participantIds: ['player', ...groupMemberIds],
      messages: [],
      unread: 0,
      type: 'group',
      typingMemberIds: [],
      creatorId: 'player',
      updatedAt: now,
    };
    commit({ ...courier, conversations: [...courier.conversations, groupConversation] });
    setSelectedId(groupConversation.id);
    setMobileView('chat');
    setShowGroupCreator(false);
    setGroupDraftName('');
    setGroupMemberIds([]);
  };

  const togglePinned = (conversationId: string) => {
    commit({
      ...courier,
      conversations: courier.conversations.map((conversation) => conversation.id === conversationId ? { ...conversation, pinned: !conversation.pinned } : conversation),
    });
  };

  const openGroupEditor = () => {
    if (!selected || selected.type !== 'group') return;
    setEditGroupName(selected.title);
    setEditGroupMemberIds(selected.participantIds.flatMap((id) => contactIdForParticipant(id) ?? []));
    setShowGroupEditor(true);
  };

  const saveGroupEditor = () => {
    if (!selected || selected.type !== 'group') return;
    commit(updateCourierGroupConversation(courier, selected.id, {
      title: editGroupName,
      memberIds: editGroupMemberIds,
    }));
    setShowGroupEditor(false);
  };

  const sendMessage = () => {
    const content = draft.trim();
    if (!selected || !content || selected.type === 'system') return;
    const timestamp = Date.now();
    const appended = appendCourierMessage(courier, selected.id, {
      id: `courier_player_${timestamp}`,
      senderId: 'player',
      senderName: travelerName?.trim() || '旅人',
      role: 'user',
      content,
      turn: resolveCourierMessageTurn(currentTurn, selected.messages),
      timestamp,
      readBy: ['player'],
    });
    const conversations = appended.conversations.map((conversation) => conversation.id === selected.id
      ? { ...conversation, unread: selected.unread, updatedAt: timestamp }
      : conversation);
    const nextCourier = { ...appended, conversations, unreadTotal: calculateCourierUnread({ conversations, deliverySeeds: appended.deliverySeeds }) };
    onCourierChange(nextCourier);
    setDraft('');
    // 即时回复：玩家一发送就触发生成，不用等下一回合。
    onRequestReply?.(selected.id, nextCourier);
  };

  const resolveSenderAvatar = (message: CourierMessage): string | undefined => {
    if (message.senderId === 'player' && travelerAvatar?.trim()) {
      return 解析相册资源引用(album, travelerAvatar) || travelerAvatar;
    }
    const fromMessage = message.avatar?.trim();
    if (fromMessage) return 解析相册资源引用(album, fromMessage) || undefined;
    const contact = courier.contacts.find((item) => item.id === message.senderId);
    const npcId = contact?.npcId?.trim();
    const npc = npcId ? npcById.get(npcId) : undefined;
    const resolved = contact?.avatar || 读取NPC头像(npc, '手机') || 读取NPC头像(npc, '正文') || 读取NPC头像(npc, '档案') || getDefaultBuiltinAvatar(contact?.name || message.senderName);
    return resolved ? 解析相册资源引用(album, resolved) || resolved : undefined;
  };

  const senderInitial = (message: CourierMessage): string => message.senderName.trim().charAt(0) || '?';
  const memberName = (participantId: string): string => {
    if (participantId === 'player') return travelerName?.trim() || '旅人';
    const contact = courier.contacts.find((item) => item.id === participantId || item.npcId === participantId);
    if (contact) return contact.name;
    return npcById.get(participantId)?.姓名 ?? participantId;
  };

  const filters: Array<{ id: ConversationFilter; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'private', label: '私聊' },
    { id: 'group', label: '群组' },
    { id: 'system', label: '系统' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="提瓦特手机">
      <section
        className="journal-story-page grid h-[100dvh] w-full grid-cols-1 overflow-hidden text-[rgb(var(--tj-text-primary))] sm:h-[min(84vh,720px)] sm:w-[min(980px,100%)] sm:grid-cols-[minmax(220px,30%)_1fr]"
        style={{
          background: 'linear-gradient(180deg, var(--journal-parchment), color-mix(in srgb, var(--journal-parchment) 86%, var(--journal-leather) 14%))',
          boxShadow: `inset 0 0 0 1px ${goldSoft(0.35)}, 0 24px 60px rgba(0, 0, 0, 0.5)`,
          clipPath: 'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)',
          ...(courier.wallpapers.home ? { backgroundImage: `linear-gradient(rgba(239, 227, 201, 0.86), rgba(239, 227, 201, 0.92)), url(${解析相册资源引用(album, courier.wallpapers.home) ?? courier.wallpapers.home})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
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
              <span className="px-2 py-0.5 text-[11px]" style={{ color: 'rgb(var(--tj-on-accent))', background: goldSoft(0.85), clipPath: clipSmall }}>
                未读 {courier.unreadTotal}
              </span>
            )}
          </header>
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
                  clipPath: clipSmall,
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowContacts((value) => !value)}
            className="mx-3 mb-2 w-[calc(100%-24px)] px-2 py-1 text-left text-[10px] tracking-[0.2em]"
            style={{ color: 'rgba(69,56,42,0.85)', boxShadow: 'inset 0 0 0 1px rgba(122,92,48,0.4)', clipPath: clipSmall }}
          >
            {showContacts ? '▾' : '▸'} 联系人管理（{courier.contacts.length}）
          </button>
          {showContacts && (
            <div className="mx-3 mb-2 space-y-1.5 px-2 py-2" style={{ background: 'rgba(255,252,240,0.55)', boxShadow: 'inset 0 0 0 1px rgba(122,92,48,0.28)', clipPath: clipSmall }}>
              {courier.contacts.map((contact) => (
                <div key={contact.id} className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => openContactConversation(contact)}
                    aria-label={`与 ${contact.name} 聊天`}
                    className="min-w-0 flex-1 truncate px-1 py-0.5 text-left text-[11px]"
                    style={{ color: 'rgba(45,38,30,0.92)' }}
                  >
                    {contact.name}
                  </button>
                  <button type="button" onClick={() => deleteContact(contact.id)} aria-label={`删除联系人 ${contact.name}`} className="shrink-0 px-1.5 text-[10px]" style={{ color: 'rgba(var(--tj-danger),0.9)' }}>
                    删除
                  </button>
                </div>
              ))}
              {eligibleNpcContacts.length > 0 ? (
                <div className="space-y-1 border-t border-[rgba(122,92,48,0.2)] pt-1.5">
                  <p className="text-[10px]" style={{ color: 'rgba(69,56,42,0.7)' }}>可添加的已结识角色</p>
                  {eligibleNpcContacts.map((npc) => (
                    <button key={npc.id} type="button" onClick={() => commit(addNpcToCourierContacts(courier, npc))} className="flex w-full items-center justify-between px-1 py-0.5 text-[11px]" style={{ color: 'rgba(45,38,30,0.92)' }}>
                      <span>{npc.姓名}</span><span aria-hidden>＋</span>
                    </button>
                  ))}
                </div>
              ) : <p className="pt-1 text-[10px] leading-4" style={{ color: 'rgba(69,56,42,0.68)' }}>联系人只能从已结识、同行或留有共同记忆的角色中添加。</p>}
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowGroupCreator((value) => !value)}
            className="mx-3 mb-2 w-[calc(100%-24px)] px-2 py-1 text-left text-[10px] tracking-[0.2em]"
            style={{ color: 'rgba(69,56,42,0.85)', boxShadow: 'inset 0 0 0 1px rgba(122,92,48,0.4)', clipPath: clipSmall }}
          >
            {showGroupCreator ? '▾' : '▸'} 组建群组
          </button>
          {showGroupCreator && (
            <div className="mx-3 mb-2 space-y-1.5 px-2 py-2" style={{ background: 'rgba(255,252,240,0.55)', boxShadow: 'inset 0 0 0 1px rgba(122,92,48,0.28)', clipPath: clipSmall }}>
              {courier.contacts.length < 2 && (
                <p className="text-[11px] leading-5" style={{ color: 'rgba(45,38,30,0.8)' }}>
                  至少需要 2 位联系人才能组建群组，先到上方添加联系人。
                </p>
              )}
              {courier.contacts.map((contact) => (
                <label key={contact.id} className="flex cursor-pointer items-center gap-2 text-[11px]" style={{ color: 'rgba(45,38,30,0.92)' }}>
                  <input
                    type="checkbox"
                    checked={groupMemberIds.includes(contact.id)}
                    onChange={() => toggleGroupMember(contact.id)}
                    aria-label={`选择群成员 ${contact.name}`}
                    className="h-3.5 w-3.5 accent-[rgb(var(--tj-accent-primary))]"
                  />
                  <span className="min-w-0 truncate">{contact.name}</span>
                </label>
              ))}
              <input
                value={groupDraftName}
                onChange={(event) => setGroupDraftName(event.target.value)}
                placeholder="群名称（可选，默认用成员名）"
                aria-label="群名称"
                className="w-full px-2 py-1 text-[11px]"
                style={{ background: 'rgba(255,252,240,0.7)', color: 'rgba(45,38,30,0.95)', boxShadow: 'inset 0 0 0 1px rgba(122,92,48,0.36)' }}
              />
              <button
                type="button"
                onClick={createGroup}
                disabled={groupMemberIds.length < 2}
                className="w-full px-2 py-1 text-[11px] disabled:opacity-40"
                style={{ color: 'rgb(var(--tj-on-accent))', background: groupMemberIds.length >= 2 ? goldSoft(0.85) : goldSoft(0.3), clipPath: clipSmall }}
              >
                组建群组（已选 {groupMemberIds.length} 人）
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {conversations.length === 0 && (
              <p className="px-1 py-6 text-center text-xs leading-6" style={{ color: muted(0.75) }}>
                还没有聊天。继续冒险后，同伴与协会的消息会出现在这里。
              </p>
            )}
            {conversations.map((conversation) => {
              const last = conversation.messages.at(-1);
              const active = selected?.id === conversation.id;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(conversation.id);
                    setMobileView('chat');
                  }}
                  className="mb-2 w-full px-3 py-2.5 text-left transition-colors"
                  style={{
                    background: active ? goldSoft(0.12) : goldSoft(0.04),
                    boxShadow: `inset 0 0 0 1px ${active ? goldSoft(0.5) : goldSoft(0.16)}`,
                    clipPath: clipSmall,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="min-w-0 truncate font-serif text-sm tracking-wide" style={{ color: ink(0.96) }}>
                      {conversation.pinned ? '📌 ' : ''}{conversation.title || '未命名会话'}
                    </strong>
                    {conversation.unread > 0 && (
                      <span className="shrink-0 px-1.5 text-[11px] font-bold" style={{ color: 'rgb(var(--tj-on-accent))', background: goldSoft(0.9) }}>
                        {conversation.unread}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[11px]" style={{ color: muted(0.8) }}>
                      {last ? `${last.senderName}：${last.content.slice(0, 24)}` : TYPE_LABELS[conversation.type]}
                    </span>
                    <span className="shrink-0 text-[10px]" style={{ color: muted(0.6) }}>
                       {conversation.type === 'group' ? `${conversation.participantIds.filter((id) => id !== 'player').length}位成员` : TYPE_LABELS[conversation.type]}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── 会话视图 ── */}
        <main className={`min-h-0 flex-col ${mobileView === 'chat' ? 'flex' : 'hidden sm:flex'}`}>
          <header className="flex items-center justify-between gap-3 border-b border-[rgba(var(--tj-accent-primary),0.2)] px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileView('list')}
                className="shrink-0 px-2 py-1 text-xs sm:hidden"
                style={{ color: goldSoft(0.9), boxShadow: `inset 0 0 0 1px ${goldSoft(0.35)}` }}
                aria-label="返回会话列表"
              >
                ←
              </button>
              <div className="min-w-0">
                <h3 className="truncate font-serif text-lg tracking-wide">{selected?.title ?? '消息'}</h3>
                {selected?.type === 'group' && (
                  <p className="truncate text-[11px]" style={{ color: muted(0.75) }}>
                    {selected.participantIds.map(memberName).join('、')}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
               {selected && (
                 selected.type === 'group' && (
                   <button
                     type="button"
                     onClick={openGroupEditor}
                     aria-label="群聊设置"
                     className="px-2 py-1 text-[11px]"
                     style={{ color: muted(0.85), boxShadow: `inset 0 0 0 1px ${goldSoft(0.25)}`, clipPath: clipSmall }}
                   >
                     群聊设置
                   </button>
                 )
               )}
               {selected && (
                 <button
                  type="button"
                  onClick={() => togglePinned(selected.id)}
                  className="px-2 py-1 text-[11px]"
                  style={{ color: muted(0.85), boxShadow: `inset 0 0 0 1px ${goldSoft(0.25)}`, clipPath: clipSmall }}
                >
                  {selected.pinned ? '取消置顶' : '置顶'}
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭手机"
                className="flex h-9 w-9 items-center justify-center text-base"
                style={{ color: ink(0.85), boxShadow: `inset 0 0 0 1px ${goldSoft(0.3)}`, clipPath: clipSmall }}
              >
                ✕
              </button>
            </div>
          </header>

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
               <div className="flex justify-end gap-2">
                 <button type="button" onClick={() => setShowGroupEditor(false)} className="px-2 py-1 text-[11px]">取消</button>
                 <button type="button" onClick={saveGroupEditor} disabled={!editGroupMemberIds.length} className="teyvat-btn teyvat-btn-primary px-3 py-1 text-[11px] disabled:opacity-40">保存</button>
               </div>
             </section>
           )}

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" style={courier.wallpapers.conversation ? { backgroundImage: `linear-gradient(rgba(239, 227, 201, 0.88), rgba(239, 227, 201, 0.92)), url(${解析相册资源引用(album, courier.wallpapers.conversation) ?? courier.wallpapers.conversation})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
            {!selected || selected.messages.length === 0 ? (
              <p className="py-10 text-center text-sm leading-6" style={{ color: muted(0.75) }}>
                {selected ? '这段会话还没有消息。' : '从左侧选择一个会话，查看协会与同伴的消息。'}
              </p>
            ) : (
              selected.messages.map((message, index) => {
                const isPlayer = message.senderId === 'player';
                const avatarUrl = resolveSenderAvatar(message);
                const startsNewTurn = index > 0 && selected.messages[index - 1].turn !== message.turn;
                return (
                  <Fragment key={message.id}>
                  {startsNewTurn && <div data-testid="phone-turn-divider" className="my-4 flex items-center gap-3" aria-label={`第 ${message.turn} 回合`}><span className="h-px flex-1 border-t border-dashed" style={{ borderColor: goldSoft(0.38) }} /><span className="text-[10px] tracking-[0.16em]" style={{ color: muted(0.72) }}>回合 {message.turn}</span><span className="h-px flex-1 border-t border-dashed" style={{ borderColor: goldSoft(0.38) }} /></div>}
                  <article data-testid={isPlayer ? 'phone-player-message-row' : undefined} className={`mb-4 flex items-start gap-3 ${isPlayer ? 'flex-row-reverse' : ''}`}>
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={`${message.senderName} 头像`} className="mt-5 h-9 w-9 shrink-0 rounded-full object-cover" style={{ boxShadow: `0 0 0 1px ${goldSoft(0.4)}` }} />
                    ) : (
                      <span className="mt-5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-serif text-sm" style={{ color: gold, boxShadow: `inset 0 0 0 1px ${goldSoft(0.35)}` }}>
                        {senderInitial(message)}
                      </span>
                    )}
                    <div className={`min-w-0 max-w-[78%] ${isPlayer ? 'text-right' : ''}`}>
                      <p className="text-[11px]" style={{ color: muted(0.72) }}>
                        {message.senderName} · 回合 {message.turn}
                        {isPlayer && message.readBy.length > 1 ? ' · 已读' : ''}
                      </p>
                      <p
                        className="mt-1 inline-block whitespace-pre-wrap px-3 py-2 text-left text-sm leading-relaxed"
                        style={{
                          color: ink(0.96),
                          background: isPlayer ? goldSoft(0.1) : 'rgba(var(--tj-chat-bubble), var(--tj-chat-bubble-alpha, 0.78))',
                          borderLeft: isPlayer ? undefined : `2px solid ${goldSoft(0.45)}`,
                          borderRight: isPlayer ? `2px solid rgba(var(--tj-accent-secondary), 0.55)` : undefined,
                          clipPath: clipSmall,
                        }}
                      >
                        {message.content}
                      </p>
                    </div>
                  </article>
                  </Fragment>
                );
              })
            )}
             {selected && selected.typingMemberIds.length > 0 && (
              <div className="flex items-center gap-2 pb-1 text-[12px]" style={{ color: muted(0.85) }}>
                <span className="inline-flex gap-[3px]">
                  {[0, 1, 2].map((dot) => (
                    <span
                      key={dot}
                      className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full"
                      style={{ background: goldSoft(0.8), animationDelay: `${dot * 0.18}s` }}
                    />
                  ))}
                </span>
                <span className="font-serif tracking-[0.1em]">
                  {selected.typingMemberIds.map((id) => contactNameById.get(id) ?? id).join('、') || '对方'} 正在输入……
                </span>
              </div>
             )}
             <div ref={messageBottomRef} data-testid="phone-message-bottom" />
           </div>

          {selected && selected.type !== 'system' ? (
            <div className="flex items-end gap-2 border-t border-[rgba(var(--tj-accent-primary),0.2)] p-3">
              <div className="min-w-0 flex-1">
                {selected.type === 'group' && (
                  <div className="mb-1.5 flex flex-wrap gap-1" aria-label="@群成员">
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
                  style={{ background: 'rgba(53,46,39,0.06)', color: ink(0.96), boxShadow: `inset 0 0 0 1px ${goldSoft(0.3)}`, clipPath: clipSmall }}
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
        </main>
      </section>
    </div>
  );
}
