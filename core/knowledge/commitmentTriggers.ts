import type { CommitmentTrigger } from '../contracts/knowledge';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import { travelDateOrdinal } from '../contracts/worldClock';

export function travelDateAfter(date: string | null, days: number): string | null {
  const current = travelDateOrdinal(date);
  if (current === null || !Number.isSafeInteger(days)) return null;
  const zero = current + days - 1, year = Math.floor(zero / 372), day = zero % 372;
  if (year < 0 || year > 999999) return null;
  return `旅行历 ${year}.${String(Math.floor(day / 31) + 1).padStart(2, '0')}.${String(day % 31 + 1).padStart(2, '0')}`;
}
export function dateTriggerFromText(text: string, moment: WorldMoment): CommitmentTrigger | null {
  const date = text.match(/旅行历\s*\d{1,6}\.\d{1,2}\.\d{1,2}/u)?.[0]
    ?? (/明天|第二天|次日/u.test(text) ? travelDateAfter(moment.date, 1) : /后天/u.test(text) ? travelDateAfter(moment.date, 2) : null);
  if (date && travelDateOrdinal(date) !== null) {
    const clock = text.match(/(?:[01]?\d|2[0-3]):[0-5]\d/u)?.[0];
    return { kind: 'date', date, ...(clock ? { clock } : {}) };
  }
  return null;
}
