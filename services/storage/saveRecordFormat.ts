import type { 存档类型 } from '@/models/settings';

export function normalizeSaveType(type: unknown): 存档类型 {
  return type === 'auto' || type === 'backup' || type === 'imported' ? type : 'manual';
}

export function sanitizeSaveFilename(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/gu, '_')
    .replace(/\s+/gu, '_')
    .slice(0, 48) || 'traveler';
}
