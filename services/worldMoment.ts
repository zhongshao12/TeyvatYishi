import type { TeyvatWorld } from '@/models/teyvat/world';
import type { WorldMoment } from '@/models/teyvat/worldMoment';

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
