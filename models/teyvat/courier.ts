export type CourierDeliveryStatus = 'pending' | 'delivered' | 'dismissed' | 'expired';

export interface CourierContact {
  id: string;
  name: string;
  npcId?: string;
  avatar?: string;
  relationLabel?: string;
  available: boolean;
  organization?: string;
  status?: 'available' | 'known_locked' | 'story_locked' | 'unavailable' | 'hidden';
  lastActiveTurn?: number;
  unlockSource?: 'story' | 'seed' | 'manual' | 'system';
}

export interface CourierLetter {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  turn: number;
  timestamp: number;
  status: CourierDeliveryStatus;
  deliveredAtTurn?: number;
}

export interface CourierMessage {
  id: string;
  senderId: string;
  senderName: string;
  role: string;
  content: string;
  turn: number;
  timestamp: number;
  avatar?: string;
  sourceSeedId?: string;
  readBy: string[];
  scheduledAtTurn?: number;
  deliveredAtTurn?: number;
}

export interface CourierLocalArchiveEntry {
  id: string;
  turn: number;
  summary: string;
  source: 'private' | 'group' | 'system';
  messageCount: number;
  createdAt: number;
  sourceSeedId?: string;
}

export interface CourierLocalArchive {
  threshold: number;
  entries: CourierLocalArchiveEntry[];
  compressedSummaries: string[];
  lastCompressedTurn?: number;
}

export interface CourierConversation {
  id: string;
  title: string;
  participantIds: string[];
  messages: CourierMessage[];
  unread: number;
  type: 'private' | 'group' | 'system';
  localArchive?: CourierLocalArchive;
  pinned?: boolean;
  typingMemberIds: string[];
  inviteCode?: string;
  announcement?: string;
  creatorId?: string;
  updatedAt: number;
}

export interface CourierDeliverySeed {
  id: string;
  senderId: string;
  reason: string;
  turn: number;
  source: 'main_story' | 'steambird' | 'memory' | 'plot' | 'system';
  triggerType: 'injury' | 'victory' | 'defeat' | 'location_change' | 'important_item' | 'relationship' | 'steambird' | 'quest' | 'time' | 'custom';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  targetType: 'private' | 'group';
  targetId: string;
  title: string;
  context: string;
  relatedNpcIds: string[];
  expiresAfterTurns?: number;
  scheduledAtTurn?: number;
  fromEvent?: 'steambird' | 'plot' | 'relationship';
  relatedEventId?: string;
  status: 'pending' | 'generated' | 'dismissed' | 'expired';
}

export interface CourierSystem {
  contacts: CourierContact[];
  letters: CourierLetter[];
  conversations: CourierConversation[];
  deliverySeeds: CourierDeliverySeed[];
  unreadTotal: number;
  wallpapers: { home?: string; conversation?: string };
}

export function createEmptyCourierSystem(): CourierSystem {
  return { contacts: [], letters: [], conversations: [], deliverySeeds: [], unreadTotal: 0, wallpapers: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const optionalText = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;
const textList = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const integer = (value: unknown): number => Math.max(0, Math.trunc(Number(value) || 0));

function normalizeContact(value: unknown): CourierContact | null {
  if (!isRecord(value)) return null;
  const statuses = ['available', 'known_locked', 'story_locked', 'unavailable', 'hidden'] as const;
  const unlockSources = ['story', 'seed', 'manual', 'system'] as const;
  const status = statuses.find((item) => item === value.status);
  const unlockSource = unlockSources.find((item) => item === value.unlockSource);
  return {
    id: text(value.id), name: text(value.name), available: value.available !== false,
    ...(optionalText(value.npcId) ? { npcId: text(value.npcId) } : {}), ...(optionalText(value.avatar) ? { avatar: text(value.avatar) } : {}),
    ...(optionalText(value.relationLabel) ? { relationLabel: text(value.relationLabel) } : {}), ...(optionalText(value.organization) ? { organization: text(value.organization) } : {}),
    ...(status ? { status } : {}), ...(Number.isFinite(Number(value.lastActiveTurn)) ? { lastActiveTurn: integer(value.lastActiveTurn) } : {}),
    ...(unlockSource ? { unlockSource } : {}),
  };
}

function normalizeMessage(value: unknown): CourierMessage | null {
  if (!isRecord(value)) return null;
  return {
    id: text(value.id), senderId: text(value.senderId), senderName: text(value.senderName), role: text(value.role),
    content: text(value.content), turn: integer(value.turn), timestamp: Number(value.timestamp) || 0,
    ...(optionalText(value.avatar) ? { avatar: text(value.avatar) } : {}), ...(optionalText(value.sourceSeedId) ? { sourceSeedId: text(value.sourceSeedId) } : {}),
    readBy: textList(value.readBy), ...(Number.isFinite(Number(value.scheduledAtTurn)) ? { scheduledAtTurn: integer(value.scheduledAtTurn) } : {}),
    ...(Number.isFinite(Number(value.deliveredAtTurn)) ? { deliveredAtTurn: integer(value.deliveredAtTurn) } : {}),
  };
}

function normalizeLocalArchive(value: unknown): CourierLocalArchive | undefined {
  if (!isRecord(value)) return undefined;
  return {
    threshold: integer(value.threshold),
    entries: Array.isArray(value.entries) ? value.entries.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const source = entry.source === 'group' || entry.source === 'system' ? entry.source : 'private';
      return [{ id: text(entry.id), turn: integer(entry.turn), summary: text(entry.summary), source, messageCount: integer(entry.messageCount), createdAt: Number(entry.createdAt) || 0, ...(optionalText(entry.sourceSeedId) ? { sourceSeedId: text(entry.sourceSeedId) } : {}) }];
    }) : [],
    compressedSummaries: textList(value.compressedSummaries),
    ...(Number.isFinite(Number(value.lastCompressedTurn)) ? { lastCompressedTurn: integer(value.lastCompressedTurn) } : {}),
  };
}

function normalizeConversation(value: unknown): CourierConversation | null {
  if (!isRecord(value)) return null;
  const type = value.type === 'group' || value.type === 'system' ? value.type : 'private';
  const localArchive = normalizeLocalArchive(value.localArchive);
  return {
    id: text(value.id), title: text(value.title), participantIds: textList(value.participantIds),
    messages: Array.isArray(value.messages) ? value.messages.flatMap((message) => normalizeMessage(message) ?? []) : [],
    unread: integer(value.unread), type, ...(localArchive ? { localArchive } : {}),
    ...(typeof value.pinned === 'boolean' ? { pinned: value.pinned } : {}), typingMemberIds: textList(value.typingMemberIds),
    ...(optionalText(value.inviteCode) ? { inviteCode: text(value.inviteCode) } : {}), ...(optionalText(value.announcement) ? { announcement: text(value.announcement) } : {}),
    ...(optionalText(value.creatorId) ? { creatorId: text(value.creatorId) } : {}), updatedAt: Number(value.updatedAt) || 0,
  };
}

function normalizeSeed(value: unknown): CourierDeliverySeed | null {
  if (!isRecord(value)) return null;
  const sources = ['main_story', 'steambird', 'memory', 'plot', 'system'] as const;
  const triggers = ['injury', 'victory', 'defeat', 'location_change', 'important_item', 'relationship', 'steambird', 'quest', 'time', 'custom'] as const;
  const priorities = ['low', 'normal', 'high', 'urgent'] as const;
  const statuses = ['pending', 'generated', 'dismissed', 'expired'] as const;
  const fromEvents = ['steambird', 'plot', 'relationship'] as const;
  const normalizedSource = value.source === 'news' ? 'steambird' : value.source;
  const normalizedTrigger = value.triggerType === 'news' ? 'steambird' : value.triggerType;
  const normalizedFromEvent = value.fromEvent === 'news' ? 'steambird' : value.fromEvent;
  return {
    id: text(value.id), senderId: text(value.senderId), reason: text(value.reason), turn: integer(value.turn),
    source: sources.find((item) => item === normalizedSource) ?? 'system', triggerType: triggers.find((item) => item === normalizedTrigger) ?? 'custom',
    priority: priorities.find((item) => item === value.priority) ?? 'normal', targetType: value.targetType === 'group' ? 'group' : 'private',
    targetId: text(value.targetId), title: text(value.title), context: text(value.context), relatedNpcIds: textList(value.relatedNpcIds),
    ...(Number.isFinite(Number(value.expiresAfterTurns)) ? { expiresAfterTurns: integer(value.expiresAfterTurns) } : {}),
    ...(Number.isFinite(Number(value.scheduledAtTurn)) ? { scheduledAtTurn: integer(value.scheduledAtTurn) } : {}),
    ...(fromEvents.find((item) => item === normalizedFromEvent) ? { fromEvent: normalizedFromEvent as CourierDeliverySeed['fromEvent'] } : {}),
    ...(optionalText(value.relatedEventId) ? { relatedEventId: text(value.relatedEventId) } : {}), status: statuses.find((item) => item === value.status) ?? 'pending',
  };
}

export function normalizeCourierSystem(value: unknown): CourierSystem {
  const raw = isRecord(value) ? value : {};
  const wallpapers = isRecord(raw.wallpapers) ? raw.wallpapers : {};
  const normalizedContacts = Array.isArray(raw.contacts) ? raw.contacts.flatMap((item) => normalizeContact(item) ?? []) : [];
  const idAliases = new Map<string, string>();
  const contactIndex = new Map<string, number>();
  const contacts: CourierContact[] = [];
  for (const contact of normalizedContacts) {
    const name = contact.name.trim();
    if (!name || !contact.id.trim()) continue;
    const identity = name.toLocaleLowerCase('zh-CN');
    const existingIndex = contactIndex.get(identity);
    if (existingIndex === undefined) {
      contacts.push({ ...contact, name });
      contactIndex.set(identity, contacts.length - 1);
      idAliases.set(contact.id, contact.id);
      continue;
    }
    const existing = contacts[existingIndex];
    idAliases.set(contact.id, existing.id);
    contacts[existingIndex] = {
      ...contact,
      ...existing,
      name: existing.name || name,
      npcId: existing.npcId || contact.npcId,
      avatar: existing.avatar || contact.avatar,
      relationLabel: existing.relationLabel || contact.relationLabel,
      organization: existing.organization || contact.organization,
      available: existing.available || contact.available,
      lastActiveTurn: Math.max(existing.lastActiveTurn ?? 0, contact.lastActiveTurn ?? 0) || undefined,
    };
  }
  const remapId = (id: string) => id === 'player' ? id : (idAliases.get(id) ?? id);
  const uniqueIds = (ids: string[]) => Array.from(new Set(ids.map(remapId).filter(Boolean)));
  const conversations = (Array.isArray(raw.conversations) ? raw.conversations.flatMap((item) => normalizeConversation(item) ?? []) : [])
    .map((conversation) => ({
      ...conversation,
      participantIds: uniqueIds(conversation.participantIds),
      typingMemberIds: uniqueIds(conversation.typingMemberIds),
      messages: conversation.messages.map((message) => ({ ...message, senderId: remapId(message.senderId) })),
    }));
  const letters = Array.isArray(raw.letters) ? raw.letters.flatMap((item) => {
    if (!isRecord(item)) return [];
    const status: CourierDeliveryStatus = item.status === 'delivered' || item.status === 'dismissed' || item.status === 'expired' ? item.status : 'pending';
    return [{ id: text(item.id), senderId: remapId(text(item.senderId)), senderName: text(item.senderName), content: text(item.content), turn: integer(item.turn), timestamp: Number(item.timestamp) || 0, status, ...(Number.isFinite(Number(item.deliveredAtTurn)) ? { deliveredAtTurn: integer(item.deliveredAtTurn) } : {}) }];
  }) : [];
  const deliverySeeds = (Array.isArray(raw.deliverySeeds) ? raw.deliverySeeds.flatMap((item) => normalizeSeed(item) ?? []) : [])
    .map((seed) => ({ ...seed, senderId: remapId(seed.senderId), targetId: remapId(seed.targetId), relatedNpcIds: uniqueIds(seed.relatedNpcIds) }));
  return {
    contacts,
    letters,
    conversations,
    deliverySeeds,
    unreadTotal: integer(raw.unreadTotal), wallpapers: { home: optionalText(wallpapers.home), conversation: optionalText(wallpapers.conversation) },
  };
}
