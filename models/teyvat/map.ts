import type { RegionId } from './world';

/**
 * G2 地图探索（一期，极简）。
 *
 * 每个地区以"七天神像"为传送枢纽：玩家在剧情抵达某地区、与神像互动后，
 * 手动标记神像已激活；此后可随时传送到该地区（更新 世界.当前地区）。
 * 不做路径寻路、不做地图坐标、不做实景绘制。
 */

export interface TeyvatMapState {
  /** 已激活七天神像的地区。 */
  unlockedStatues: RegionId[];
  lastTeleportTurn: number;
}

export const TEYVAT_MAP_REGION_IDS: RegionId[] = ['mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan', 'nod_krai'];

export const MAP_REGION_NAMES: Record<RegionId, string> = {
  mondstadt: '蒙德',
  liyue: '璃月',
  inazuma: '稻妻',
  sumeru: '须弥',
  fontaine: '枫丹',
  natlan: '纳塔',
  nod_krai: '至冬',
};

/** 地区主地标：传送时同步更新 世界.当前地点，避免地区与地点错位一回合。 */
export const MAP_REGION_MAIN_LOCATIONS: Record<RegionId, string> = {
  mondstadt: '蒙德 · 蒙德城',
  liyue: '璃月 · 璃月港',
  inazuma: '稻妻 · 稻妻城',
  sumeru: '须弥 · 须弥城',
  fontaine: '枫丹 · 枫丹廷',
  natlan: '纳塔 · 圣火竞技场',
  nod_krai: '至冬 · 挪德卡莱',
};

/** 开局只有蒙德神像已激活（与六国开局锚点所在一致）。 */
export function createEmptyTeyvatMapState(): TeyvatMapState {
  return { unlockedStatues: ['mondstadt'], lastTeleportTurn: 0 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeTeyvatMapState(value: unknown): TeyvatMapState {
  const raw = isRecord(value) ? value : {};
  const unlocked = Array.isArray(raw.unlockedStatues)
    ? raw.unlockedStatues.filter((item): item is RegionId => TEYVAT_MAP_REGION_IDS.includes(item as RegionId))
    : [];
  return {
    unlockedStatues: unlocked.length ? [...new Set(unlocked)] : createEmptyTeyvatMapState().unlockedStatues,
    lastTeleportTurn: Number.isFinite(Number(raw.lastTeleportTurn)) ? Math.max(0, Math.trunc(Number(raw.lastTeleportTurn))) : 0,
  };
}

export function isStatueUnlocked(map: TeyvatMapState, regionId: RegionId): boolean {
  return map.unlockedStatues.includes(regionId);
}

export function unlockStatue(map: TeyvatMapState, regionId: RegionId): TeyvatMapState {
  if (map.unlockedStatues.includes(regionId)) return map;
  return { ...map, unlockedStatues: [...map.unlockedStatues, regionId] };
}

/** 传送前置校验：目标地区神像必须已激活。 */
export function canTeleportTo(map: TeyvatMapState, regionId: RegionId): boolean {
  return isStatueUnlocked(map, regionId);
}

export function markTeleport(map: TeyvatMapState, turn: number): TeyvatMapState {
  return { ...map, lastTeleportTurn: Math.max(0, Math.trunc(turn)) };
}
