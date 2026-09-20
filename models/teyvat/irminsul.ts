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
    }];
  }) : [];
  return {
    entries: entries.slice(-MAX_IRMINSUL_ENTRIES),
  };
}
import { isRecord } from '@/utils/valueGuards';
