import { createEmptyCanonTrack, type CanonTrack } from './canon';
import { normalizeCanonTrack } from '@/services/canonDeviationService';
import { createEmptyArchiveCodex, normalizeArchiveCodex, type ArchiveCodex } from './codex';
import { createEmptyCourierSystem, normalizeCourierSystem, type CourierSystem } from './courier';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeTeyvatGameState(input: unknown): TeyvatGameState {
  const raw = isRecord(input) ? input : {};
  if (raw.universe !== undefined && raw.universe !== 'teyvat') throw new Error('UNSUPPORTED_RUNTIME_UNIVERSE');

  const base = createEmptyTeyvatGameState();
  return {
    ...base,
    universe: 'teyvat',
    schemaVersion: TEYVAT_SCHEMA_VERSION,
    turnCount: Math.max(0, Math.trunc(Number(raw.turnCount) || 0)),
    旅行者: normalizeTravelerProfile(raw.旅行者),
    世界: normalizeTeyvatWorld(raw.世界),
    NPC: normalizeTeyvatNpcRecords(raw.NPC),
    背包: normalizeTeyvatInventory(raw.背包),
    手机: normalizeCourierSystem(raw.手机),
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
