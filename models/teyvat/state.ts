import { createEmptyCanonTrack, type CanonTrack } from './canon';
import { normalizeCanonTrack } from '@/services/canonDeviationService';
import { createEmptyArchiveCodex, normalizeArchiveCodex, type ArchiveCodex } from './codex';
import { createEmptyCourierSystem, normalizeCourierSystem, reconcileCourierContactsWithNpcs, type CourierSystem } from './courier';
import { createEmptyIrminsulMemory, normalizeIrminsulMemory, type IrminsulMemory } from './irminsul';
import { createEmptyTeyvatInventory, normalizeTeyvatInventory, type TeyvatInventory } from './items';
import {
  createEmptyBackgroundQueueState,
  createEmptyConversationLog,
  createEmptyJourneyAlbum,
  createEmptyMemoryLedger,
  createEmptyNarrativeRuntime,
  createEmptyQuestJournal,
  normalizeBackgroundQueueState,
  normalizeConversationLog,
  normalizeJourneyAlbum,
  normalizeMemoryLedger,
  normalizeNarrativeRuntime,
  normalizeQuestJournal,
  type BackgroundQueueState,
  type ConversationLog,
  type JourneyAlbum,
  type MemoryLedger,
  type NarrativeRuntime,
  type QuestJournal,
} from './runtimeSlices';
import { createEmptyTeyvatMapState, normalizeTeyvatMapState, type TeyvatMapState } from './map';
import { createEmptySteambirdNews, normalizeSteambirdNews, type SteambirdNews } from './steambird';
import { createEmptyTravelerProfile, normalizeTeyvatNpcRecords, normalizeTravelerProfile, type TravelerProfile, type TeyvatNpcRecord } from './character';
import { createEmptyTeyvatWorld, type TeyvatWorld } from './world';
import { normalizeTeyvatWorld } from './world';
import { matchCanonicalIdentity } from '@/data/canonicalCharacters';
import { migrateTeyvatFirstPartner } from '@/utils/npcFirstPartner';

export const TEYVAT_SCHEMA_VERSION = 2 as const;

export interface TeyvatGameState {
  universe: 'teyvat';
  schemaVersion: typeof TEYVAT_SCHEMA_VERSION;
  turnCount: number;
  旅行者: TravelerProfile;
  世界: TeyvatWorld;
  NPC: TeyvatNpcRecord[];
  背包: TeyvatInventory;
  手机: CourierSystem;
  世界树: IrminsulMemory;
  图鉴: ArchiveCodex;
  蒸汽鸟报: SteambirdNews;
  原著轨道: CanonTrack;
  对话: ConversationLog;
  记忆: MemoryLedger;
  相册: JourneyAlbum;
  任务: QuestJournal;
  后台队列: BackgroundQueueState;
  叙事: NarrativeRuntime;
  地图: TeyvatMapState;
}

export type TeyvatSaveData = TeyvatGameState;

export function createEmptyTeyvatGameState(): TeyvatGameState {
  return {
    universe: 'teyvat',
    schemaVersion: TEYVAT_SCHEMA_VERSION,
    turnCount: 0,
    旅行者: createEmptyTravelerProfile(),
    世界: createEmptyTeyvatWorld(),
    NPC: [],
    背包: createEmptyTeyvatInventory(),
    手机: createEmptyCourierSystem(),
    世界树: createEmptyIrminsulMemory(),
    图鉴: createEmptyArchiveCodex(),
    蒸汽鸟报: createEmptySteambirdNews(),
    原著轨道: createEmptyCanonTrack(),
    对话: createEmptyConversationLog(),
    记忆: createEmptyMemoryLedger(),
    相册: createEmptyJourneyAlbum(),
    任务: createEmptyQuestJournal(),
    后台队列: createEmptyBackgroundQueueState(),
    叙事: createEmptyNarrativeRuntime(),
    地图: createEmptyTeyvatMapState(),
  };
}

function pruneUnselectedCanonicalTraveler(
  courier: CourierSystem,
  npcs: readonly TeyvatNpcRecord[],
  selected: TeyvatWorld['原著旅行者'],
): { courier: CourierSystem; npcs: TeyvatNpcRecord[] } {
  const excludedName = selected === '荧' ? '空' : selected === '空' ? '荧' : '';
  if (!excludedName) return { courier, npcs: [...npcs] };

  const isExcludedIdentity = (input: { id?: string; name?: string; aliases?: readonly string[] }) =>
    matchCanonicalIdentity(input)?.name === excludedName;
  const excludedNpcIds = new Set(npcs
    .filter((npc) => isExcludedIdentity({ id: npc.id, name: npc.姓名, aliases: npc.aliases }))
    .map((npc) => npc.id));
  const filteredNpcs = npcs.filter((npc) => !excludedNpcIds.has(npc.id));
  const excludedContactIds = new Set(courier.contacts
    .filter((contact) => excludedNpcIds.has(contact.npcId ?? '')
      || isExcludedIdentity({ id: contact.npcId || contact.id, name: contact.name }))
    .map((contact) => contact.id));
  const contacts = courier.contacts.filter((contact) => !excludedContactIds.has(contact.id));
  const conversations = courier.conversations.flatMap((conversation) => {
    const participantIds = conversation.participantIds.filter((id) => !excludedContactIds.has(id) && !excludedNpcIds.has(id));
    const messages = conversation.messages.filter((message) => !excludedContactIds.has(message.senderId)
      && !excludedNpcIds.has(message.senderId)
      && !isExcludedIdentity({ id: message.senderId, name: message.senderName }));
    const nonPlayerCount = participantIds.filter((id) => id !== 'player').length;
    if (conversation.type === 'private' && nonPlayerCount === 0) return [];
    if (conversation.type === 'group' && nonPlayerCount < 2) return [];
    return [{
      ...conversation,
      participantIds,
      messages,
      typingMemberIds: conversation.typingMemberIds.filter((id) => participantIds.includes(id)),
    }];
  });
  const letters = courier.letters.filter((letter) => !excludedContactIds.has(letter.senderId)
    && !excludedNpcIds.has(letter.senderId)
    && !isExcludedIdentity({ id: letter.senderId, name: letter.senderName }));
  const deliverySeeds = courier.deliverySeeds
    .filter((seed) => !excludedContactIds.has(seed.senderId)
      && !excludedNpcIds.has(seed.senderId)
      && !isExcludedIdentity({ id: seed.senderId, name: seed.title }))
    .map((seed) => ({
      ...seed,
      relatedNpcIds: seed.relatedNpcIds.filter((id) => !excludedNpcIds.has(id) && !excludedContactIds.has(id)),
    }));
  const unreadTotal = conversations.reduce((total, conversation) => total + conversation.unread, 0)
    + deliverySeeds.filter((seed) => seed.status === 'pending').length;
  return {
    npcs: filteredNpcs,
    courier: normalizeCourierSystem({ ...courier, contacts, conversations, letters, deliverySeeds, unreadTotal }),
  };
}

export function normalizeTeyvatGameState(input: unknown): TeyvatGameState {
  const raw = isRecord(input) ? input : {};
  if (raw.universe !== undefined && raw.universe !== 'teyvat') throw new Error('UNSUPPORTED_RUNTIME_UNIVERSE');

  const base = createEmptyTeyvatGameState();
  const world = normalizeTeyvatWorld(raw.世界);
  const traveler = normalizeTravelerProfile(raw.旅行者);
  const normalizedNpcs = normalizeTeyvatNpcRecords(raw.NPC)
    .map((npc) => migrateTeyvatFirstPartner(npc, traveler.姓名));
  const reconciledCourier = reconcileCourierContactsWithNpcs(raw.手机, normalizedNpcs);
  const roster = pruneUnselectedCanonicalTraveler(reconciledCourier, normalizedNpcs, world.原著旅行者);
  return {
    ...base,
    universe: 'teyvat',
    schemaVersion: TEYVAT_SCHEMA_VERSION,
    turnCount: Math.max(0, Math.trunc(Number(raw.turnCount) || 0)),
    旅行者: traveler,
    世界: world,
    NPC: roster.npcs,
    背包: normalizeTeyvatInventory(raw.背包),
    手机: roster.courier,
    世界树: normalizeIrminsulMemory(raw.世界树),
    图鉴: normalizeArchiveCodex(raw.图鉴),
    蒸汽鸟报: normalizeSteambirdNews(raw.蒸汽鸟报),
    原著轨道: normalizeCanonTrack(raw.原著轨道),
    对话: normalizeConversationLog(raw.对话),
    记忆: normalizeMemoryLedger(raw.记忆),
    相册: normalizeJourneyAlbum(raw.相册),
    任务: normalizeQuestJournal(raw.任务),
    后台队列: normalizeBackgroundQueueState(raw.后台队列),
    叙事: normalizeNarrativeRuntime(raw.叙事),
    地图: normalizeTeyvatMapState(raw.地图),
  };
}
import { isRecord } from '@/utils/valueGuards';
