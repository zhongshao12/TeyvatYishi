import { matchCanonicalIdentity } from '@/data/canonicalCharacters';
import type { TeyvatNpcRecord } from './character';

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

export const MAX_COURIER_MESSAGES_PER_CONVERSATION = 400;

export function createEmptyCourierSystem(): CourierSystem {
  return { contacts: [], letters: [], conversations: [], deliverySeeds: [], unreadTotal: 0, wallpapers: {} };
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

export function normalizeCourierConversation(value: unknown): CourierConversation | null {
  if (!isRecord(value)) return null;
  const type = value.type === 'group' || value.type === 'system' ? value.type : 'private';
  const localArchive = normalizeLocalArchive(value.localArchive);
  const normalized: CourierConversation = {
    id: text(value.id), title: text(value.title), participantIds: textList(value.participantIds),
    messages: Array.isArray(value.messages) ? value.messages.flatMap((message) => normalizeMessage(message) ?? []) : [],
    unread: integer(value.unread), type, ...(localArchive ? { localArchive } : {}),
    ...(typeof value.pinned === 'boolean' ? { pinned: value.pinned } : {}), typingMemberIds: textList(value.typingMemberIds),
    ...(optionalText(value.inviteCode) ? { inviteCode: text(value.inviteCode) } : {}), ...(optionalText(value.announcement) ? { announcement: text(value.announcement) } : {}),
    ...(optionalText(value.creatorId) ? { creatorId: text(value.creatorId) } : {}), updatedAt: Number(value.updatedAt) || 0,
  };
  if (normalized.messages.length <= MAX_COURIER_MESSAGES_PER_CONVERSATION) return normalized;

  const trimmed = normalized.messages.slice(0, -MAX_COURIER_MESSAGES_PER_CONVERSATION);
  const kept = normalized.messages.slice(-MAX_COURIER_MESSAGES_PER_CONVERSATION);
  const first = trimmed[0];
  const last = trimmed.at(-1);
  if (!first || !last) return { ...normalized, messages: kept };
  const archiveId = `courier_archive_${normalized.id}_${first.id}_${last.id}`;
  const summarySamples = [trimmed[0], trimmed[Math.floor(trimmed.length / 2)], trimmed.at(-1)]
    .flatMap((message) => message ? [`${message.senderName}：${message.content.replace(/\s+/g, ' ').trim().slice(0, 80)}`] : []);
  const summary = `已归档早期通讯 ${trimmed.length} 条（回合 ${first.turn}—${last.turn}）：${summarySamples.join('；')}`;
  const previousArchive = normalized.localArchive ?? {
    threshold: MAX_COURIER_MESSAGES_PER_CONVERSATION,
    entries: [],
    compressedSummaries: [],
  };
  const entries = previousArchive.entries.some((entry) => entry.id === archiveId)
    ? previousArchive.entries
    : [...previousArchive.entries, {
        id: archiveId,
        turn: last.turn,
        summary,
        source: normalized.type,
        messageCount: trimmed.length,
        createdAt: last.timestamp,
      }].slice(-24);
  const compressedSummaries = previousArchive.compressedSummaries.includes(summary)
    ? previousArchive.compressedSummaries
    : [...previousArchive.compressedSummaries, summary].slice(-24);
  return {
    ...normalized,
    messages: kept,
    unread: Math.min(normalized.unread, kept.length),
    localArchive: {
      ...previousArchive,
      threshold: MAX_COURIER_MESSAGES_PER_CONVERSATION,
      entries,
      compressedSummaries,
      lastCompressedTurn: last.turn,
    },
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
    if (!existing) {
      contacts.push({ ...contact, name });
      contactIndex.set(identity, contacts.length - 1);
      idAliases.set(contact.id, contact.id);
      continue;
    }
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
  const conversations = (Array.isArray(raw.conversations) ? raw.conversations.flatMap((item) => normalizeCourierConversation(item) ?? []) : [])
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

function courierNpcAvatar(npc: TeyvatNpcRecord): string | undefined {
  return npc.visualArchive.slotImages.courier
    || npc.visualArchive.slotImages.profile
    || npc.visualArchive.profileImage
    || npc.avatar
    || undefined;
}

/**
 * Keep the phone identity index aligned with encountered canon NPC records.
 * Durable NPC ids win over model-written display labels, and private threads are renamed with them.
 */
export function reconcileCourierContactsWithNpcs(value: unknown, npcs: readonly TeyvatNpcRecord[]): CourierSystem {
  const normalized = normalizeCourierSystem(value);
  const npcById = new Map(npcs.map((npc) => [npc.id, npc]));
  const npcByName = new Map<string, TeyvatNpcRecord>();
  const npcByCanonicalName = new Map<string, TeyvatNpcRecord>();
  for (const npc of npcs) {
    if (npc.姓名 && !npcByName.has(npc.姓名)) npcByName.set(npc.姓名, npc);
    for (const alias of npc.aliases) {
      if (alias && !npcByName.has(alias)) npcByName.set(alias, npc);
    }
    const canonicalName = matchCanonicalIdentity({ id: npc.id, name: npc.姓名, aliases: npc.aliases })?.name;
    if (canonicalName && !npcByCanonicalName.has(canonicalName)) npcByCanonicalName.set(canonicalName, npc);
  }
  const findNpc = (contact: CourierContact): TeyvatNpcRecord | undefined => {
    const exactId = contact.npcId || contact.id;
    const exact = npcById.get(exactId) ?? npcById.get(contact.id);
    if (exact) return exact;
    const canonical = matchCanonicalIdentity({ id: exactId, name: contact.name });
    if (canonical) return npcByCanonicalName.get(canonical.name);
    return npcByName.get(contact.name);
  };

  const contacts = normalized.contacts.map((contact) => {
    const npc = findNpc(contact);
    if (!npc) return contact;
    const avatar = contact.avatar || courierNpcAvatar(npc);
    return {
      ...contact,
      name: npc.姓名,
      npcId: npc.id,
      available: true,
      status: 'available' as const,
      ...(avatar ? { avatar } : {}),
    };
  });

  const contactNpcIds = new Set(contacts.flatMap((contact) => [contact.id, contact.npcId ?? '']).filter(Boolean));
  const contactNames = new Set(contacts.map((contact) => contact.name));
  const contactCanonicalNames = new Set(contacts.flatMap((contact) => {
    const name = matchCanonicalIdentity({ id: contact.npcId || contact.id, name: contact.name })?.name;
    return name ? [name] : [];
  }));
  for (const npc of npcs) {
    const encounteredCanon = npc.canonical
      && npc.roleTier === 'companion'
      && (npc.firstSeenTurn > 0 || npc.lastSeenTurn > 0 || Boolean(npc.relationshipLedger.recentInteraction));
    if (!encounteredCanon) continue;
    const canonical = matchCanonicalIdentity({ id: npc.id, name: npc.姓名, aliases: npc.aliases });
    const exists = contactNpcIds.has(npc.id)
      || contactNames.has(npc.姓名)
      || (Boolean(canonical) && contactCanonicalNames.has(canonical!.name));
    if (exists) continue;
    const avatar = courierNpcAvatar(npc);
    const added: CourierContact = {
      id: `contact_${npc.id}`,
      npcId: npc.id,
      name: npc.姓名,
      available: true,
      status: 'available',
      unlockSource: 'story',
      lastActiveTurn: npc.lastSeenTurn || undefined,
      ...(avatar ? { avatar } : {}),
    };
    contacts.push(added);
    contactNpcIds.add(added.id);
    contactNpcIds.add(npc.id);
    contactNames.add(npc.姓名);
    if (canonical) contactCanonicalNames.add(canonical.name);
  }

  const repaired = normalizeCourierSystem({ ...normalized, contacts });
  const contactById = new Map(repaired.contacts.map((contact) => [contact.id, contact]));
  const conversations = repaired.conversations.map((conversation) => {
    if (conversation.type !== 'private') return conversation;
    const contact = conversation.participantIds
      .filter((id) => id !== 'player')
      .map((id) => contactById.get(id))
      .find(Boolean);
    if (!contact) return conversation;
    return {
      ...conversation,
      title: contact.name,
      messages: conversation.messages.map((message) => message.senderId === contact.id
        ? { ...message, senderName: contact.name, ...(contact.avatar ? { avatar: contact.avatar } : {}) }
        : message),
    };
  });
  const letters = repaired.letters.map((letter) => {
    const contact = contactById.get(letter.senderId);
    return contact ? { ...letter, senderName: contact.name } : letter;
  });
  return { ...repaired, conversations, letters };
}
import { isRecord } from '@/utils/valueGuards';
