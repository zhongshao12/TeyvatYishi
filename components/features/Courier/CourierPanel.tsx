import { CLIP_ITEM } from '@/styles/clipPaths';
import { lazy, Suspense, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CourierContact, CourierConversation, CourierDeliverySeed, CourierMessage, CourierMomentImage, CourierSystem } from '@/models/teyvat/courier';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import type { NPC记录 } from '@/models/npc';
import { 读取NPC头像 } from '@/models/npc';
import type { 相册系统 } from '@/models/imageGeneration';
import { appendCourierMessage, calculateCourierUnread, canAddNpcToCourierContacts, canDissolveCourierGroupConversation, dissolveCourierGroupConversation, updateCourierGroupConversation } from '@/services/ai/courierService';
import { 解析相册资源引用 } from '@/utils/albumActions';
import { getDefaultBuiltinAvatar } from '@/data/builtinAvatars';
import { pushToast } from '@/utils/toastStore';
import { sanitizeCourierMessageText } from '@/utils/courierTextSanitizer';
import { CourierConversationList } from './CourierConversationList';
import { CourierMessageTimeline } from './CourierMessageTimeline';
import { CourierContactTools } from './CourierContactTools';
import { CourierMomentsPanel } from './CourierMomentsPanel';
import { countEligibleMomentCommenters, createMoment, deleteMoment, editMoment, parseMomentMentions, restoreMoment, type MomentMentionBinding } from '@/services/courierMoments';
import { createCourierPlayerMessageId } from '@/utils/courierReplyBatch';
import { displayCourierContactName } from '@/services/courierContactRemark';
import { resolveCourierPhotoTarget, sameCourierPhotoTarget, type CourierPhotoTarget } from '@/services/courierPhoto';
import type { CourierPhotoComposerProps } from './CourierPhotoComposer';
import type { API设置, 文生图系统设置 } from '@/models/settings';
import type { 角色数据结构 } from '@/models/character';
import { CourierPhotoAction, type CourierPhotoReplyQueue } from './CourierPhotoAction';
import '@/styles/journal-phone.css';

const CourierPhotoComposer = lazy(() => import('./CourierPhotoComposer').then(module => ({ default: module.CourierPhotoComposer })));

export interface CourierPanelProps {
  enabled?: boolean;
  visible?: boolean;
  onOpenSettings?: () => void;
  courier: CourierSystem;
  album?: 相册系统;
  imageSettings?: 文生图系统设置;
  apiSettings?: API设置;
  traveler?: 角色数据结构;
  onAlbumChange?: CourierPhotoComposerProps['onAlbumChange'];
  onCommitPhoto?: CourierPhotoComposerProps['onCommitPhoto'];
  npcRecords?: NPC记录[];
  travelerName?: string;
  travelerAvatar?: string;
  /** 当前主叙事回合；用于把本次手机消息与上一主回合可靠分隔。 */
  currentTurn?: number;
  worldMoment?: WorldMoment | null;
  onCourierChange: (update: CourierSystem | ((previous: CourierSystem) => CourierSystem)) => void;
  /** 玩家发送后请求回信；第二个参数是刚提交的玩家消息 ID。 */
  onRequestReply?: (conversationId: string, messageId: string) => void;
  replyErrorByConversationId?: Record<string, string>;
  replyQueue?: CourierPhotoReplyQueue;
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

export const CourierPanel = memo(function CourierPanel({ courier, album, imageSettings, apiSettings, traveler, onAlbumChange, onCommitPhoto, npcRecords = [], travelerName, travelerAvatar, currentTurn = 0, worldMoment, onCourierChange, onRequestReply, replyErrorByConversationId, replyQueue, onRetryReply, getGameSessionId, onRequestMomentComments, canGenerateMomentComments = false, enabled = true, visible = true, onOpenSettings, onClose }: CourierPanelProps) {
  const [selectedId, setSelectedId] = useState(courier.conversations[0]?.id ?? '');
  // U02（PROJECT_AUDIT_2026-10-03）：草稿按**会话**隔离 —— 旧实现只有一个 draft，
  // 切到别的会话再切回来时草稿内容会跟着走，容易发错人。这里按 conversationId 暂存，
  // 并跟随游戏 session 重置（换存档不把旧草稿带进新档）。
  const draftSessionId = typeof getGameSessionId === 'function' ? getGameSessionId() : null;
  const [draftState, setDraftState] = useState<{ sessionId: number | null; drafts: Record<string, string> }>({
    sessionId: null,
    drafts: {},
  });
  const [filter, setFilter] = useState<ConversationFilter>('all');
  const [mobileView, setMobileView] = useState<MobileView>('list');
  const [phoneSection, setPhoneSection] = useState<'chats' | 'contacts' | 'moments'>('chats');
  const [photoSelection, setPhotoSelection] = useState<{ target: CourierPhotoTarget; sessionId: number | null } | null>(null);
  const [showGroupEditor, setShowGroupEditor] = useState(false);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupMemberIds, setEditGroupMemberIds] = useState<string[]>([]);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [visibleConversationCount, setVisibleConversationCount] = useState(INITIAL_VISIBLE_CONVERSATIONS);
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
    setFilter('all');
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
    ?? conversations[0]
    ?? null;
  const draftKey = selected?.id ?? '';
  const drafts = draftState.sessionId === draftSessionId ? draftState.drafts : {};
  const draft = drafts[draftKey] ?? '';
  const setDraft = (update: string | ((previous: string) => string)) => {
    if (!draftKey) return;
    setDraftState((previous) => {
      const sameSession = previous.sessionId === draftSessionId;
      const base = sameSession ? previous.drafts : {};
      const current = base[draftKey] ?? '';
      const next = typeof update === 'function' ? update(current) : update;
      if (next === current && sameSession) return previous;
      return { sessionId: draftSessionId, drafts: { ...base, [draftKey]: next } };
    });
  };
  const photoConversationId = selected?.id;
  const photoRequestInputs = useRef({ courier, npcRecords, photoConversationId, getGameSessionId });
  useLayoutEffect(() => { photoRequestInputs.current = { courier, npcRecords, photoConversationId, getGameSessionId }; }, [courier, npcRecords, photoConversationId, getGameSessionId]);
  const requestPhoto = useCallback((messageId: string) => {
    const inputs = photoRequestInputs.current;
    const resolved = inputs.photoConversationId && resolveCourierPhotoTarget(inputs.courier, inputs.npcRecords, inputs.photoConversationId, messageId);
    if (resolved) setPhotoSelection({ target: resolved.target, sessionId: inputs.getGameSessionId?.() ?? null });
  }, []);
  const resolvePhoto = useCallback((message: CourierMessage) => {
    const ref = message.photo;
    const entry = ref && album?.entries.find(item => item.id === ref.entryId && item.assetId === ref.assetId && item.targetId === ref.npcId && !item.nsfw);
    const asset = entry && album?.assets.find(item => item.id === ref?.assetId && !item.nsfw);
    return asset ? 解析相册资源引用(album, `asset:${asset.id}`) || undefined : undefined;
  }, [album]);
  const resolvedPhotoTarget = photoSelection && photoSelection.target.conversationId === selected?.id && photoSelection.sessionId === draftSessionId
    ? resolveCourierPhotoTarget(courier, npcRecords, photoSelection.target.conversationId, photoSelection.target.messageId)?.target : undefined;
  const photoTarget = photoSelection && resolvedPhotoTarget && sameCourierPhotoTarget(photoSelection.target, resolvedPhotoTarget) ? photoSelection.target : undefined;
  useEffect(() => { setPhotoSelection(null); }, [selected?.id, draftSessionId, filter, phoneSection, mobileView]);

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

  // U03（PROJECT_AUDIT_2026-10-03）：阅读历史时不要被新消息拉回底部。
  // 旧实现是「selected 一变就 scrollIntoView」——玩家往上翻旧消息时，新消息一进来就被拽回底部。
  // 现在：原本贴底才跟随；向上阅读时保留位置，并显示「有 N 条新消息」按钮。
  const messageScrollRef = useRef<HTMLDivElement | null>(null);
  const [messageCountAtBottom, setMessageCountAtBottom] = useState(0);
  const followBottomRef = useRef(true);
  const selectedMessageCount = selected?.messages.length ?? 0;
  const pendingNewMessages = followBottomRef.current ? 0 : Math.max(0, selectedMessageCount - messageCountAtBottom);
  const handleMessageScroll = useCallback(() => {
    const container = messageScrollRef.current;
    if (!container) return;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 48;
    followBottomRef.current = nearBottom;
    if (nearBottom) setMessageCountAtBottom(selectedMessageCount);
  }, [selectedMessageCount]);
  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = messageScrollRef.current;
    if (!container) return;
    followBottomRef.current = true;
    setMessageCountAtBottom(selectedMessageCount);
    container.scrollTo?.({ top: container.scrollHeight, behavior });
  }, [selectedMessageCount]);

  useLayoutEffect(() => {
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    // 切换会话/进入聊天：这是玩家主动进入，仍然跳到最新。
    followBottomRef.current = true;
    setMessageCountAtBottom(selected?.messages.length ?? 0);
  }, [selected?.id]);

  useLayoutEffect(() => {
    if (!selected || mobileView !== 'chat') return;
    // 玩家正在向上阅读时不打断；只在贴底时跟随新消息。
    if (followBottomRef.current) {
      messageBottomRef.current?.scrollIntoView({ block: 'end' });
      setMessageCountAtBottom(selected.messages.length);
    }
  }, [selected, mobileView, selected?.messages.length]);

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

  // 打开会话即已读 —— 但仅当**这段会话真的显示在屏幕上**（B16，PROJECT_AUDIT_2026-10-03）：
  // 旧实现只看 `selected`，于是「停留在手机列表页」「停留在朋友圈」「所选会话被过滤掉」时
  // 也会把它标成已读，玩家回来时红点已经没了。
  const chatSurfaceVisible = visible && enabled && phoneSection === 'chats' && (
    mobileView === 'chat'
    // ≥ sm 时聊天主栏始终可见（见下面的 `hidden sm:flex`），列表与聊天同时显示。
    || (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 640px)').matches
      : false)
  );
  const selectedIsVisible = Boolean(selected && conversations.some((conversation) => conversation.id === selected.id));
  useEffect(() => {
    if (chatSurfaceVisible && !photoTarget && selectedIsVisible && selected?.unread) markConversationRead(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.unread, chatSurfaceVisible, selectedIsVisible, Boolean(photoTarget)]);

  const eligibleNpcContacts = useMemo(() => {
    const knownNpcIds = new Set(courier.contacts.flatMap((contact) => [contact.id, contact.npcId ?? '']));
    const nameCounts = new Map<string, number>();
    for (const npc of npcRecords) nameCounts.set(npc.姓名.trim(), (nameCounts.get(npc.姓名.trim()) ?? 0) + 1);
    const knownLegacyNames = new Set(courier.contacts.filter((contact) => !contact.npcId
      && nameCounts.get(contact.name.trim()) === 1).map((contact) => contact.name.trim()));
    return npcRecords.filter((npc) => canAddNpcToCourierContacts(npc)
      && !knownNpcIds.has(npc.id) && !knownNpcIds.has(`contact_${npc.id}`)
      && !knownLegacyNames.has(npc.姓名.trim()));
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
    const actionSessionId = getGameSessionId?.();
    const receipt: { snapshot?: { group: CourierConversation; originalIndex: number; removedSeeds: CourierDeliverySeed[]; nextSelectedId: string } } = {};
    // 先确认活体提交成功，再显示成功/撤销；不能用渲染时的权限冒充提交结果。
    flushSync(() => commit((previous) => {
      if (getGameSessionId && getGameSessionId() !== actionSessionId) return previous;
      const next = dissolveCourierGroupConversation(previous, selected.id);
      const group = previous.conversations.find((item) => item.id === selected.id);
      if (next === previous || !group) return previous;
      receipt.snapshot = { group, originalIndex: previous.conversations.indexOf(group),
        removedSeeds: previous.deliverySeeds.filter((seed) => seed.targetId === group.id),
        nextSelectedId: next.conversations[0]?.id ?? '' };
      return next;
    }));
    if (!receipt.snapshot) {
      pushToast({ kind: 'info', title: '未解散群聊', detail: '群聊已变化，或你不是创建者。' });
      return;
    }
    const { group, originalIndex, removedSeeds, nextSelectedId } = receipt.snapshot;
    setShowGroupEditor(false);
    setSelectedId(nextSelectedId);
    setMobileView('list');
    pushToast({
      kind: 'info',
      title: `已解散「${group.title || '未命名群聊'}」`,
      detail: '群聊记录已移除，联系人与私聊保留。点「撤销」可以恢复。',
      durationMs: UNDO_WINDOW_MS,
      action: {
        label: '撤销',
        run: () => {
          if (getGameSessionId && getGameSessionId() !== actionSessionId) return;
          onCourierChange((current) => {
            if ((getGameSessionId && getGameSessionId() !== actionSessionId)
              || !current.deletedConversationIds?.includes(group.id)
              || current.conversations.some((conversation) => conversation.id === group.id)) return current;
            const conversations = [...current.conversations];
            conversations.splice(Math.min(originalIndex, conversations.length), 0, group);
            const existingSeedIds = new Set(current.deliverySeeds.map((seed) => seed.id));
            const deliverySeeds = [...current.deliverySeeds, ...removedSeeds.filter((seed) => !existingSeedIds.has(seed.id))];
            return { ...current, conversations, deliverySeeds,
              deletedConversationIds: current.deletedConversationIds.filter((id) => id !== group.id),
              unreadTotal: calculateCourierUnread({ conversations, deliverySeeds }) };
          });
          setSelectedId(group.id);
          setMobileView('chat');
        },
      },
    });
  };

  const sendMessage = () => {
    if (!selected || !draft.trim() || selected.type === 'system') return;
    const content = sanitizeCourierMessageText(draft);
    if (!content) {
      pushToast({ kind: 'error', title: '消息正文含内部记录，无法发送。', detail: '请填写正常聊天内容。' });
      return;
    }
    const timestamp = Date.now();
    const messageId = createCourierPlayerMessageId();
    followBottomRef.current = true;
    onCourierChange((previous) => {
      const next = appendCourierMessage(previous, selected.id, {
        id: messageId,
        senderId: 'player',
        senderName: travelerName?.trim() || '旅人',
        role: 'user',
        content,
        turn: resolveCourierMessageTurn(currentTurn, selected.messages),
        timestamp,
        ...(worldMoment ? { worldMoment } : {}),
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

  const publishMoment = (content: string, images?: readonly CourierMomentImage[], bindings?: readonly MomentMentionBinding[]) => {
    if ((courier.moments?.length ?? 0) >= 500) {
      pushToast({ kind: 'info', title: '朋友圈已满', detail: '最多保存 500 条动态；删除旧动态后可继续发布。' });
      return false;
    }
    const id = `moment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    // @ 点名（2026-09-29 第 7 项）：发布时即解析并落库；被点名的角色一定会回应一次。
    commit((previous) => (previous.moments?.length ?? 0) >= 500
      ? previous
      : createMoment(previous, { id, content, images, turn: currentTurn, now,
        mentionIds: parseMomentMentions(content, previous.contacts, bindings), ...(worldMoment ? { worldMoment } : {}) }));
    onRequestMomentComments?.(id, 1);
    return true;
  };
  const reviseMoment = (id: string, content: string, images?: readonly CourierMomentImage[], revision?: number, bindings?: readonly MomentMentionBinding[]) => {
    const post = courier.moments?.find((item) => item.id === id);
    if (!post || (revision !== undefined && post.revision !== revision)) return false;
    // 编辑后必须重新解析 @：正文里可能已经删掉或新增了点名。
    commit((previous) => {
      if (!previous.moments?.some(item => item.id === id && item.revision === post.revision)) return previous;
      const parsed = parseMomentMentions(content, previous.contacts, bindings);
      const retained = content.trim() === post.content ? (post.mentionIds ?? []).filter(npcId => previous.contacts.some(contact =>
        contact.npcId === npcId && contact.available && (!contact.status || contact.status === 'available'))) : [];
      const explicitlyReselected = bindings?.some(binding => !binding.fromArchive
        && content.slice(binding.start, binding.start + binding.token.length) === binding.token);
      const mentionIds = content.trim() === post.content && post.mentionIds?.length && !explicitlyReselected ? retained : parsed;
      return editMoment(previous, id, content, Date.now(), mentionIds, images);
    });
    onRequestMomentComments?.(id, post.revision + 1);
    return true;
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

  if (!enabled) return <section className="p-6 text-sm leading-7" aria-label="手机已关闭">
    <div className="flex items-center justify-between gap-3"><h2 className="font-serif text-lg">手机系统已关闭</h2>
      <button type="button" className="min-h-11 min-w-11 text-base" aria-label="关闭手机" onClick={onClose}>✕</button></div>
    <p>开启手机系统后，才能发送消息和接收同伴回信；已有记录会保留。</p>
    {onOpenSettings && <button type="button" className="teyvat-btn min-h-11 px-4" onClick={onOpenSettings}>打开手机设置</button>}
  </section>;
  return (
      <section
        aria-label="提瓦特手机内容"
        className="journal-story-page journal-phone flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden text-[rgb(var(--tj-text-primary))]"
        style={{
          background: 'linear-gradient(180deg, var(--journal-parchment), color-mix(in srgb, var(--journal-parchment) 86%, var(--journal-leather) 14%))',
          boxShadow: `inset 0 0 0 1px ${goldSoft(0.35)}, 0 24px 60px rgba(0, 0, 0, 0.5)`,
          ...(courier.wallpapers.home ? { backgroundImage: `linear-gradient(rgba(239, 227, 201, 0.86), rgba(239, 227, 201, 0.92)), url(${resolveAlbumValue(courier.wallpapers.home) ?? courier.wallpapers.home})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
        }}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
          <div><p className="text-[10px] tracking-[.25em]" style={{ color: gold }}>TRAVELER'S PHONE</p><h2 className="font-serif text-lg">提瓦特手机</h2></div>
          <div className="flex items-center gap-2">
            {courier.unreadTotal > 0 && <span className="rounded-full px-2 py-1 text-xs" style={{ background: 'var(--phone-green)', color: 'rgb(var(--tj-on-accent))' }}>未读 {courier.unreadTotal}</span>}
            {onOpenSettings && <button type="button" className="min-h-11 rounded border px-3 text-xs" onClick={onOpenSettings}>手机设置</button>}
            <button type="button" className="min-h-11 min-w-11 text-base" aria-label="关闭手机" onClick={onClose}>✕</button>
          </div>
        </header>
        <nav className="flex shrink-0 gap-2 border-b px-4 py-2" aria-label="手机分区">
          {([{ id: 'chats', label: '消息' }, { id: 'contacts', label: '通讯录' }, { id: 'moments', label: '朋友圈' }] as const).map(item =>
            <button key={item.id} type="button" className="phone-filter min-h-11 flex-1 rounded-full border px-3 text-sm" aria-pressed={phoneSection === item.id}
              onClick={() => { setPhoneSection(item.id); if (item.id === 'chats') setMobileView('chat'); }}>{item.label}</button>)}
        </nav>
        <div className={`min-h-0 flex-1 grid-cols-1 sm:grid-cols-[minmax(220px,30%)_1fr] ${phoneSection === 'chats' ? 'grid' : 'flex flex-col'}`}>
        {/* ── 会话列表 ── */}
        <aside className={`min-h-0 flex-col border-r border-[rgba(var(--tj-accent-primary),0.2)] ${phoneSection !== 'chats' ? 'hidden' : mobileView === 'list' ? 'flex' : 'hidden sm:flex'}`}>
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
          <CourierConversationList
            conversations={visibleConversations}
            displayTitleByConversationId={displayTitleByConversationId}
            selectedId={selected?.id}
            hiddenConversationCount={hiddenConversationCount}
            onSelect={handleSelectConversation}
            onShowMore={handleShowMoreConversations}
          />
        </aside>
        <section className={`min-h-0 flex-1 overflow-y-auto py-4 ${phoneSection === 'contacts' ? '' : 'hidden'}`} aria-label="通讯录">
          <CourierContactTools courier={courier} eligibleNpcContacts={eligibleNpcContacts} onCourierChange={onCourierChange} onOpenConversation={handleSelectConversation} />
        </section>

        {/* ── 会话视图 ── */}
        <main className={`min-h-0 flex-1 flex-col ${phoneSection === 'contacts' ? 'hidden' : phoneSection === 'moments' || mobileView === 'chat' ? 'flex' : 'hidden sm:flex'}`}>
          <header className={`items-center justify-between gap-3 border-b border-[rgba(var(--tj-accent-primary),0.2)] px-4 py-3 ${phoneSection === 'chats' ? 'flex' : 'hidden'}`}>
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
            </div>
          </header>

           {phoneSection === 'moments' && (
             <CourierMomentsPanel
               key={`moments:${draftSessionId}`}
               moments={courier.moments ?? []} travelerName={travelerName ?? '旅行者'}
               eligibleCommenterCount={eligibleMomentCommenterCount} canGenerateComments={canGenerateMomentComments}
               commenterNames={momentCommenterNames}
               album={album}
               imageTools={album && imageSettings && onAlbumChange && onCommitPhoto ? { album, imageSettings, apiSettings, traveler, npcRecords, getGameSessionId, onAlbumChange, onCommitPhoto } : undefined}
               mentionCandidates={courier.contacts
                 .filter((contact) => contact.available && (!contact.status || contact.status === 'available') && contact.npcId && contact.name?.trim())
                 .map((contact) => ({ npcId: contact.npcId!, name: contact.name!.trim(), remark: contact.remark }))}
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
                   disabled={!canDissolveCourierGroupConversation(courier, selected.id)}
                   title={canDissolveCourierGroupConversation(courier, selected.id) ? undefined : '只有群聊创建者可以解散'}
                   className="px-2 py-1 text-[11px] disabled:opacity-40"
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
            scrollContainerRef={messageScrollRef}
            onScroll={handleMessageScroll}
            resolveSenderAvatar={resolveSenderAvatar}
            onShowEarlier={handleShowEarlierMessages}
            resolvePhoto={album ? resolvePhoto : undefined}
          />
          {photoTarget && chatSurfaceVisible && selectedIsVisible && album && imageSettings && onAlbumChange && onCommitPhoto && <Suspense fallback={<p role="status" className="p-3 text-xs">照片工具载入中…</p>}>
            <CourierPhotoComposer key={`${draftSessionId}:${photoTarget.conversationId}:${photoTarget.messageId}`} target={photoTarget} courier={courier} album={album} npcRecords={npcRecords}
              imageSettings={imageSettings} apiSettings={apiSettings} getGameSessionId={getGameSessionId} onAlbumChange={onAlbumChange} onCommitPhoto={onCommitPhoto} onClose={() => setPhotoSelection(null)} />
          </Suspense>}

          {pendingNewMessages > 0 && (
            <div className="flex justify-center px-3 pb-1">
              <button
                type="button"
                className="min-h-11 rounded-full px-4 text-xs underline"
                style={{ background: 'rgba(var(--tj-accent-primary),0.14)', color: 'rgb(var(--tj-text-primary))' }}
                onClick={() => scrollMessagesToBottom('smooth')}
              >
                有 {pendingNewMessages} 条新消息 ↓
              </button>
            </div>
          )}

          {selected && replyErrorByConversationId?.[selected.id] && (
            <div role="alert" className="mx-3 flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs" style={{ color: ink(0.92), background: 'rgba(160,63,52,0.12)', clipPath: CLIP_ITEM }}>
              <span>回信失败，消息已保留。{replyErrorByConversationId[selected.id] === 'api_unavailable' ? '请检查手机或主模型 API 设置。' : '请稍后重试。'}</span>
              <button type="button" className="min-h-11 px-3 underline" onClick={() => onRetryReply?.(selected.id)}>重试回信</button>
            </div>
          )}

          {selected && selected.type !== 'system' ? (
            <div className="flex items-end gap-2 border-t border-[rgba(var(--tj-accent-primary),0.2)] p-3">
              {imageSettings && onAlbumChange && onCommitPhoto && <CourierPhotoAction courier={courier} npcRecords={npcRecords} conversationId={selected.id}
                replyQueue={replyQueue} failed={Boolean(replyErrorByConversationId?.[selected.id])} onRequest={requestPhoto} />}
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
        </div>
      </section>
  );
});
