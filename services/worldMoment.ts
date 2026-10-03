import type { TeyvatWorld } from '@/models/teyvat/world';
import type { WorldMoment, WorldMomentRange } from '@/models/teyvat/worldMoment';

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validTurn(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function optionalTravelDay(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

/** Freeze the settled values before asynchronous work can observe a later turn. */
export function captureWorldMoment(world: TeyvatWorld, turn: number, settlementId: string): Readonly<WorldMoment> {
  if (!validTurn(turn)) throw new RangeError('World moment requires a non-negative integer turn');
  const id = optionalText(settlementId);
  if (!id) throw new Error('World moment requires a settlement ID');
  return Object.freeze({
    worldName: '提瓦特' as const,
    date: optionalText(world.当前日期),
    clock: optionalText(world.当前时间),
    weather: optionalText(world.当前天气),
    location: optionalText(world.当前地点),
    travelDay: optionalTravelDay(world.旅程天数),
    turn,
    settlementId: id,
  });
}

/** Read saved provenance without substituting the player's current world. */
export function normalizeWorldMoment(raw: unknown): WorldMoment | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (!validTurn(value.turn)) return null;
  const settlementId = optionalText(value.settlementId);
  if (!settlementId) return null;
  return {
    worldName: '提瓦特',
    date: optionalText(value.date),
    clock: optionalText(value.clock),
    weather: optionalText(value.weather),
    location: optionalText(value.location),
    travelDay: optionalTravelDay(value.travelDay),
    turn: value.turn,
    settlementId,
  };
}

/** Compact label for chat timelines; never infer game time from a device timestamp. */
export function formatWorldMomentBrief(moment: WorldMoment | null | undefined): string {
  if (!moment) return '游戏时间未记录';
  return `游戏时间：${moment.date ?? '日期未记录'} ${moment.clock ?? '时刻未记录'}`;
}

/** Combine source ranges in narrative order without inventing missing endpoints. */
export function combineWorldMomentRanges(ranges: readonly (WorldMomentRange | null | undefined)[]): WorldMomentRange {
  const first = ranges[0];
  const last = ranges.at(-1);
  return {
    start: first?.start ?? null,
    end: last?.end ?? null,
    sourceIds: [...new Set(ranges.flatMap((range) => range?.sourceIds ?? []))],
  };
}

export function normalizeWorldMomentRange(raw: unknown): WorldMomentRange | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  return {
    start: normalizeWorldMoment(value.start),
    end: normalizeWorldMoment(value.end),
    sourceIds: Array.isArray(value.sourceIds)
      ? [...new Set(value.sourceIds.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).map((id) => id.trim()))]
      : [],
  };
}

/** User-facing game chronology; technical recordedAt never substitutes for an absent game moment. */
export function formatWorldMomentRange(range: WorldMomentRange | null | undefined): string {
  const start = range?.start;
  const end = range?.end;
  const span = (left: string | number | null | undefined, right: string | number | null | undefined, mixed: string) => {
    if (left == null && right == null) return '未记录';
    if (left == null || right == null) return `${left ?? '未记录'} → ${right ?? '未记录'}`;
    return left === right ? String(left) : mixed || `${left} → ${right}`;
  };
  const date = span(start?.date, end?.date, `${start?.date} → ${end?.date}`);
  const clock = span(start?.clock, end?.clock, `${start?.clock} → ${end?.clock}`);
  const weather = span(start?.weather, end?.weather, '多天气');
  const location = span(start?.location, end?.location, '多地点');
  const travelDay = span(start?.travelDay, end?.travelDay, `第 ${start?.travelDay}–${end?.travelDay} 天`);
  return `提瓦特 · ${date} ${clock} · 天气 ${weather} · 地点 ${location} · 旅行日 ${travelDay}`;
}
