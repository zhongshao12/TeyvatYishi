/** Travel calendar retained from the game: 12 months, 31 days each, not Gregorian. */
export function travelDateOrdinal(value: string | null): number | null {
  if (typeof value !== 'string') return null;
  const match = /^旅行历\s*(\d{1,6})\.(\d{1,2})\.(\d{1,2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return year * 372 + (month - 1) * 31 + day;
}

/** Do not clamp invalid clocks or guess a missing time from the computer clock. */
export function worldClockMinutes(value: string | null): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}
