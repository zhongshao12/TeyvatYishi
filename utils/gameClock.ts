/** Extract and clamp an HH:mm clock value from display text. */
export function parseGameClock(value?: string | null): string {
  const raw = value?.trim();
  if (!raw) return '';
  const clockText = raw.match(/(\d{1,2}:\d{2})/)?.[1];
  if (!clockText) return '';
  const [rawHours = '', rawMinutes = ''] = clockText.split(':');
  const hours = Number(rawHours);
  const minutes = Number(rawMinutes);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return '';
  return `${Math.max(0, Math.min(23, hours)).toString().padStart(2, '0')}:${Math.max(0, Math.min(59, minutes)).toString().padStart(2, '0')}`;
}
