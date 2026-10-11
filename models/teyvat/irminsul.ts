import { normalizeSourceTurns } from '@/models/memorySource';

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
  sourceMomentRange?: import('./worldMoment').WorldMomentRange;
  /** Exact lower-layer archive identities consumed by this summary; absent on unverifiable legacy entries. */
  coveredEntryIds?: string[];
  /** Missing on old entries means active. Pending summaries are visible but not recallable. */
  status?: 'active' | 'pending';
}

export interface IrminsulMemory {
  entries: IrminsulEntry[];
}

export const MAX_IRMINSUL_ENTRIES = 600;

const LAYER_RANK: Record<IrminsulEntry['archiveType'], number> = { short: 1, medium: 2, long: 3, refined: 4 };

/** Conservative textual evidence: every original fact clause must remain, not just its IDs/turns. */
export function hasCompleteIrminsulSourceCoverage(sources: readonly IrminsulEntry[], summary: string): boolean {
  const facts = (text: string) => text.split(/[\r\n。！？；;]+/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').replace(/\s+/g, '')).filter(Boolean);
  const target = new Set(facts(summary));
  return sources.length > 0 && sources.every((source) => {
    const sourceFacts = facts(source.sourceText);
    return sourceFacts.length > 0 && sourceFacts.every((fact) => target.has(fact));
  });
}

export function hasVerifiedIrminsulCoverage(entries: readonly IrminsulEntry[], upper: IrminsulEntry): boolean {
  const ids = upper.coveredEntryIds;
  if (!ids?.length || new Set(ids).size !== ids.length || !upper.summary.trim()
    || upper.status === 'pending' || ids.includes(upper.id)) return false;
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const sources = ids.map((id) => byId.get(id));
  if (sources.some((source) => !source || source.status === 'pending')) return false;
  if (!sources.every((source) => source && (LAYER_RANK[source.archiveType] < LAYER_RANK[upper.archiveType]
    || (upper.archiveType === 'refined' && source.archiveType === 'refined' && source.turn === upper.turn)))) return false;
  if (sources.some((source) => !source || source.sourceTurns.length === 0)) return false;
  if (!hasCompleteIrminsulSourceCoverage(sources as IrminsulEntry[], upper.summary)) return false;
  const sourceTurns = new Set(sources.flatMap((source) => source?.sourceTurns ?? []));
  const upperTurns = new Set(upper.sourceTurns);
  return sourceTurns.size === upperTurns.size && [...sourceTurns].every((turn) => upperTurns.has(turn));
}

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
      sourceTurns: normalizeSourceTurns(value.sourceTurns),
      keywords: Array.isArray(value.keywords) ? value.keywords.map(String) : [],
      recordedAt: String(value.recordedAt ?? ''), archiveType, sourceText: String(value.sourceText ?? ''),
      turn: Math.max(0, Math.trunc(Number(value.turn) || 0)),
      ...(normalizeWorldMomentRange(value.sourceMomentRange) ? { sourceMomentRange: normalizeWorldMomentRange(value.sourceMomentRange)! } : {}),
      ...(Array.isArray(value.coveredEntryIds) ? {
        coveredEntryIds: [...new Set(value.coveredEntryIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim()))],
      } : {}),
      ...(value.status === 'active' || value.status === 'pending' ? { status: value.status as IrminsulEntry['status'] } : {}),
    }];
  }) : [];
  const protectedIds = new Set(entries.filter((entry) => entry.status === 'pending')
    .flatMap((entry) => [entry.id, ...(entry.coveredEntryIds ?? [])]));
  const verifiedCoveredIds = new Set(entries.flatMap((upper) => hasVerifiedIrminsulCoverage(entries, upper) ? upper.coveredEntryIds ?? [] : []));
  // Capacity is a soft limit: never silently evict the only original evidence.
  for (const entry of entries) if (!verifiedCoveredIds.has(entry.id)) protectedIds.add(entry.id);
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
import { normalizeWorldMomentRange } from '@/services/worldMoment';
