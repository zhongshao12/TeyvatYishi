export interface IrminsulEntry {
  id: string;
  title: string;
  summary: string;
  sourceTurns: number[];
  keywords: string[];
  recordedAt: string;
  archiveType: 'short' | 'medium' | 'long' | 'refined';
  sourceText: string;
  turn: number;
  /** Exact lower-layer archive identities consumed by this summary; absent on unverifiable legacy entries. */
  coveredEntryIds?: string[];
  /** Missing on old entries means active. Pending summaries are visible but not recallable. */
  status?: 'active' | 'pending';
}

export interface IrminsulMemory {
  entries: IrminsulEntry[];
}

export const MAX_IRMINSUL_ENTRIES = 600;

export function createEmptyIrminsulMemory(): IrminsulMemory {
  return { entries: [] };
}

export function normalizeIrminsulMemory(input: unknown): IrminsulMemory {
  const raw = isRecord(input) ? input : {};
  const entries = Array.isArray(raw.entries) ? raw.entries.flatMap((value) => {
    if (!isRecord(value)) return [];
    const archiveType = ['short', 'medium', 'long', 'refined'].includes(String(value.archiveType))
      ? value.archiveType as IrminsulEntry['archiveType'] : 'short';
    return [{
      id: String(value.id ?? ''), title: String(value.title ?? ''), summary: String(value.summary ?? ''),
      sourceTurns: Array.isArray(value.sourceTurns) ? value.sourceTurns.map((turn) => Math.max(0, Math.trunc(Number(turn) || 0))) : [],
      keywords: Array.isArray(value.keywords) ? value.keywords.map(String) : [],
      recordedAt: String(value.recordedAt ?? ''), archiveType, sourceText: String(value.sourceText ?? ''),
      turn: Math.max(0, Math.trunc(Number(value.turn) || 0)),
      ...(Array.isArray(value.coveredEntryIds) ? {
        coveredEntryIds: [...new Set(value.coveredEntryIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim()))],
      } : {}),
      ...(value.status === 'active' || value.status === 'pending' ? { status: value.status as IrminsulEntry['status'] } : {}),
    }];
  }) : [];
  const protectedIds = new Set(entries.filter((entry) => entry.status === 'pending')
    .flatMap((entry) => [entry.id, ...(entry.coveredEntryIds ?? [])]));
  const protectedEntries = entries.filter((entry) => protectedIds.has(entry.id));
  const remaining = Math.max(0, MAX_IRMINSUL_ENTRIES - protectedEntries.length);
  const newestUnprotected = remaining > 0
    ? entries.filter((entry) => !protectedIds.has(entry.id)).slice(-remaining) : [];
  const keptIds = new Set([...protectedEntries, ...newestUnprotected].map((entry) => entry.id));
  return {
    entries: entries.filter((entry) => keptIds.has(entry.id)),
  };
}
import { isRecord } from '@/utils/valueGuards';
