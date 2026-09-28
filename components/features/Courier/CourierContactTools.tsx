import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { NPC记录 } from '@/models/npc';
import type { CourierConversation, CourierSystem } from '@/models/teyvat/courier';
import {
  addNpcToCourierContacts,
  calculateCourierUnread,
} from '@/services/ai/courierService';
import { CLIP_ITEM } from '@/styles/clipPaths';
import { displayCourierContactName, setCourierContactRemark } from '@/services/courierContactRemark';

interface CourierContactToolsProps {
  courier: CourierSystem;
  eligibleNpcContacts: NPC记录[];
  onCourierChange: (update: CourierSystem | ((previous: CourierSystem) => CourierSystem)) => void;
  onOpenConversation: (conversationId: string) => void;
}

const goldSoft = (alpha: number) => `rgba(var(--tj-accent-primary), ${alpha})`;

export const CourierContactTools = memo(function CourierContactTools({
  courier,
  eligibleNpcContacts,
  onCourierChange,
  onOpenConversation,
}: CourierContactToolsProps) {
  const [showContacts, setShowContacts] = useState(false);
  const [showGroupCreator, setShowGroupCreator] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [groupMemberSearch, setGroupMemberSearch] = useState('');
  const [groupDraftName, setGroupDraftName] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [remarkDraft, setRemarkDraft] = useState('');
  const pendingPrivateChats = useRef(new Map<string, string>());
  useEffect(() => { pendingPrivateChats.current.clear(); }, [courier]);
  const contactById = useMemo(
    () => new Map(courier.contacts.map((contact) => [contact.id, contact])),
    [courier.contacts],
  );
  const validGroupMemberIds = groupMemberIds.filter((id) => contactById.has(id));
  const contactQuery = contactSearch.trim().toLocaleLowerCase();
  const groupMemberQuery = groupMemberSearch.trim().toLocaleLowerCase();
  const filteredContacts = courier.contacts.filter((contact) =>
    contact.name.toLocaleLowerCase().includes(contactQuery) || displayCourierContactName(contact).toLocaleLowerCase().includes(contactQuery));
  const filteredEligibleNpcContacts = eligibleNpcContacts.filter((npc) => npc.姓名.toLocaleLowerCase().includes(contactQuery));
  const filteredGroupMembers = courier.contacts.filter((contact) => contact.name.toLocaleLowerCase().includes(groupMemberQuery));

  const commit = (update: CourierSystem | ((previous: CourierSystem) => CourierSystem)) => {
    onCourierChange((previous) => {
      const next = typeof update === 'function' ? update(previous) : update;
      return {
        ...next,
        unreadTotal: calculateCourierUnread({ conversations: next.conversations, deliverySeeds: next.deliverySeeds }),
      };
    });
  };

  const openContactConversation = (contactId: string) => {
    const contact = contactById.get(contactId);
    if (!contact) return;
    const pendingId = pendingPrivateChats.current.get(contactId);
    if (pendingId) {
      onOpenConversation(pendingId);
      setShowContacts(false);
      return;
    }
    const existing = courier.conversations.find((conversation) =>
      conversation.type === 'private' && conversation.participantIds.includes(contact.id));
    if (existing) {
      onOpenConversation(existing.id);
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
    pendingPrivateChats.current.set(contactId, conversation.id);
    commit((previous) => previous.conversations.some((item) => item.id === conversation.id)
      ? previous
      : { ...previous, conversations: [...previous.conversations, conversation] });
    onOpenConversation(conversation.id);
    setShowContacts(false);
  };

  const toggleGroupMember = (contactId: string) => {
    setGroupMemberIds((current) => current.includes(contactId)
      ? current.filter((id) => id !== contactId)
      : [...current, contactId]);
  };

  const createGroup = () => {
    if (validGroupMemberIds.length < 2) return;
    const memberNames = validGroupMemberIds
      .map((id) => contactById.get(id)?.name?.trim())
      .filter((name): name is string => Boolean(name));
    const title = groupDraftName.trim() || memberNames.join('、');
    if (!title) return;
    const now = Date.now();
    const groupConversation: CourierConversation = {
      id: `courier_group_${now}`,
      title,
      participantIds: ['player', ...validGroupMemberIds],
      messages: [],
      unread: 0,
      type: 'group',
      typingMemberIds: [],
      creatorId: 'player',
      updatedAt: now,
    };
    commit((previous) => {
      const liveContactIds = new Set(previous.contacts.map((contact) => contact.id));
      const participantIds = validGroupMemberIds.filter((id) => liveContactIds.has(id));
      if (participantIds.length < 2) return previous;
      return { ...previous, conversations: [...previous.conversations, { ...groupConversation, participantIds: ['player', ...participantIds] }] };
    });
    onOpenConversation(groupConversation.id);
    setShowGroupCreator(false);
    setGroupDraftName('');
    setGroupMemberIds([]);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setShowContacts((value) => !value)}
        className="mx-3 mb-2 min-h-11 w-[calc(100%-24px)] px-2 py-1 text-left text-sm tracking-[0.08em]"
        style={{ color: 'rgba(69,56,42,0.85)', boxShadow: 'inset 0 0 0 1px rgba(122,92,48,0.4)', clipPath: CLIP_ITEM }}
      >
        {showContacts ? '▾' : '▸'} 联系人管理（{courier.contacts.length}）
      </button>
      {showContacts && (<>
        <input
          type="search" aria-label="搜索联系人" placeholder="搜索联系人姓名" value={contactSearch}
          onChange={(event) => setContactSearch(event.target.value)}
          className="mx-3 mb-2 min-h-11 w-[calc(100%-24px)] rounded-md px-3 text-sm outline-offset-2"
          style={{ background: 'rgba(255,252,240,0.76)', color: 'rgb(var(--tj-text-primary))', border: '1px solid rgba(var(--tj-accent-primary),0.35)' }}
        />
        <div
          aria-label="联系人列表"
          className="mx-3 mb-2 space-y-1.5 overscroll-contain px-2 py-2 pr-1"
          style={{
            maxHeight: '13rem',
            overflowY: 'auto',
            scrollbarGutter: 'stable',
            background: 'rgba(255,252,240,0.55)',
            boxShadow: 'inset 0 0 0 1px rgba(122,92,48,0.28)',
            clipPath: CLIP_ITEM,
          }}
        >
          {filteredContacts.map((contact) => (
            <div key={contact.id} className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => openContactConversation(contact.id)}
                aria-label={`与 ${contact.name} 聊天`}
                className="min-h-11 min-w-0 flex-1 truncate px-2 py-1 text-left text-sm"
                style={{ color: 'rgba(45,38,30,0.92)' }}
              >
                {displayCourierContactName(contact)}
              </button>
              <button
                type="button"
                onClick={() => { setEditingContactId(contact.id); setRemarkDraft(contact.remark ?? ''); }}
                aria-label={`编辑联系人备注 ${contact.name}`}
                className="min-h-11 shrink-0 px-2 text-xs"
                style={{ color: 'rgba(69,56,42,0.88)' }}
              >备注</button>
              <button type="button" onClick={() => commit((previous) => ({ ...previous, contacts: previous.contacts.filter((item) => item.id !== contact.id) }))} aria-label={`删除联系人 ${contact.name}`} className="min-h-11 shrink-0 px-3 text-xs" style={{ color: 'rgba(var(--tj-danger),0.9)' }}>
                删除
              </button>
              {editingContactId === contact.id && (
                <div className="flex w-full flex-wrap items-center gap-1 px-2 pb-1">
                  <input
                    aria-label="联系人备注" value={remarkDraft} maxLength={40}
                    onChange={(event) => setRemarkDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
                      commit((previous) => setCourierContactRemark(previous, contact.id, remarkDraft));
                      setEditingContactId(null);
                    }}
                    placeholder={`给 ${contact.name} 写备注`}
                    className="min-h-11 min-w-0 flex-1 px-2 text-sm"
                    style={{ background: 'rgba(255,252,240,0.8)', color: 'rgb(var(--tj-text-primary))' }}
                  />
                  <button type="button" aria-label="保存联系人备注" onClick={() => { commit((previous) => setCourierContactRemark(previous, contact.id, remarkDraft)); setEditingContactId(null); }} className="min-h-11 px-2 text-xs">保存</button>
                  <button type="button" aria-label="清除联系人备注" onClick={() => { commit((previous) => setCourierContactRemark(previous, contact.id, '')); setEditingContactId(null); }} className="min-h-11 px-2 text-xs">清除</button>
                  <button type="button" onClick={() => setEditingContactId(null)} className="min-h-11 px-2 text-xs">取消</button>
                </div>
              )}
            </div>
          ))}
          {filteredEligibleNpcContacts.length > 0 ? (
            <div className="space-y-1 border-t border-[rgba(122,92,48,0.2)] pt-1.5">
              <p className="text-xs" style={{ color: 'rgba(69,56,42,0.7)' }}>可添加的已结识角色</p>
              {filteredEligibleNpcContacts.map((npc) => (
                <button key={npc.id} type="button" onClick={() => commit((previous) => addNpcToCourierContacts(previous, npc))} className="flex min-h-11 w-full items-center justify-between px-2 py-1 text-sm" style={{ color: 'rgba(45,38,30,0.92)' }}>
                  <span>{npc.姓名}</span><span aria-hidden>＋</span>
                </button>
              ))}
            </div>
          ) : !contactQuery && <p className="pt-1 text-xs leading-5" style={{ color: 'rgba(69,56,42,0.68)' }}>联系人只能从已结识、同行或留有共同记忆的角色中添加。</p>}
          {contactQuery && filteredContacts.length === 0 && filteredEligibleNpcContacts.length === 0 && (
            <p className="py-3 text-center text-sm" style={{ color: 'rgba(69,56,42,0.8)' }}>没有匹配的联系人，请换个名字试试。</p>
          )}
        </div>
      </>)}
      <button
        type="button"
        onClick={() => setShowGroupCreator((value) => !value)}
        className="mx-3 mb-2 min-h-11 w-[calc(100%-24px)] px-2 py-1 text-left text-sm tracking-[0.08em]"
        style={{ color: 'rgba(69,56,42,0.85)', boxShadow: 'inset 0 0 0 1px rgba(122,92,48,0.4)', clipPath: CLIP_ITEM }}
      >
        {showGroupCreator ? '▾' : '▸'} 组建群组
      </button>
      {showGroupCreator && (
        <div className="mx-3 mb-2 space-y-1.5 px-2 py-2" style={{ background: 'rgba(255,252,240,0.55)', boxShadow: 'inset 0 0 0 1px rgba(122,92,48,0.28)', clipPath: CLIP_ITEM }}>
          {courier.contacts.length < 2 && (
            <p className="text-sm leading-6" style={{ color: 'rgba(45,38,30,0.8)' }}>
              至少需要 2 位联系人才能组建群组，先到上方添加联系人。
            </p>
          )}
          <input
            type="search" aria-label="搜索群成员" placeholder="搜索群成员姓名" value={groupMemberSearch}
            onChange={(event) => setGroupMemberSearch(event.target.value)}
            className="min-h-11 w-full rounded-md px-3 text-sm outline-offset-2"
            style={{ background: 'rgba(255,252,240,0.76)', color: 'rgb(var(--tj-text-primary))', border: '1px solid rgba(var(--tj-accent-primary),0.35)' }}
          />
          <div
            aria-label="群聊成员列表"
            className="space-y-1.5 overscroll-contain pr-1"
            style={{ maxHeight: '13rem', overflowY: 'auto', scrollbarGutter: 'stable' }}
          >
            {filteredGroupMembers.map((contact) => (
              <label key={contact.id} className="flex min-h-11 cursor-pointer items-center gap-2 px-2 text-sm" style={{ color: 'rgba(45,38,30,0.92)' }}>
                <input
                  type="checkbox"
                  checked={groupMemberIds.includes(contact.id)}
                onChange={() => toggleGroupMember(contact.id)}
                  aria-label={`选择群成员 ${contact.name}`}
                  className="h-5 w-5 accent-[rgb(var(--tj-accent-primary))]"
                />
                <span className="min-w-0 truncate">{contact.name}</span>
              </label>
            ))}
            {groupMemberQuery && filteredGroupMembers.length === 0 && (
              <p className="py-3 text-center text-sm" style={{ color: 'rgba(69,56,42,0.8)' }}>没有匹配的群成员，请换个名字试试。</p>
            )}
          </div>
          <input
            value={groupDraftName}
            onChange={(event) => setGroupDraftName(event.target.value)}
            placeholder="群名称（可选，默认用成员名）"
            aria-label="群名称"
            className="min-h-11 w-full px-3 py-1 text-sm"
            style={{ background: 'rgba(255,252,240,0.7)', color: 'rgba(45,38,30,0.95)', boxShadow: 'inset 0 0 0 1px rgba(122,92,48,0.36)' }}
          />
          <button
            type="button"
            onClick={createGroup}
            disabled={validGroupMemberIds.length < 2}
            className="min-h-11 w-full px-2 py-1 text-sm disabled:opacity-40"
            style={{ color: 'rgb(var(--tj-on-accent))', background: validGroupMemberIds.length >= 2 ? goldSoft(0.85) : goldSoft(0.3), clipPath: CLIP_ITEM }}
          >
            组建群组（已选 {validGroupMemberIds.length} 人）
          </button>
        </div>
      )}
    </>
  );
});
