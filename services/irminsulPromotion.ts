import { normalizeIrminsulMemory, type IrminsulEntry, type IrminsulMemory } from '@/models/teyvat/irminsul';

const LAYER_RANK: Record<IrminsulEntry['archiveType'], number> = {
  short: 1, medium: 2, long: 3, refined: 4,
};

export function getActiveIrminsulEntries(memory: IrminsulMemory): IrminsulEntry[] {
  return memory.entries.filter((entry) => entry.status !== 'pending');
}

function hasVerifiedCoverage(entries: readonly IrminsulEntry[], upper: IrminsulEntry): boolean {
  const ids = upper.coveredEntryIds;
  if (!ids?.length || new Set(ids).size !== ids.length || !upper.summary.trim()
    || upper.status === 'pending' || ids.includes(upper.id)) return false;
  const sources = ids.map((id) => entries.find((entry) => entry.id === id));
  if (sources.some((source) => !source || source.status === 'pending')) return false;
  const validLayers = sources.every((source) => source && (LAYER_RANK[source.archiveType] < LAYER_RANK[upper.archiveType]
    || (upper.archiveType === 'refined' && source.archiveType === 'refined' && source.turn === upper.turn)));
  if (!validLayers) return false;
  if (sources.some((source) => !source || source.sourceTurns.length === 0)) return false;
  const sourceTurns = new Set(sources.flatMap((source) => source?.sourceTurns ?? []));
  const upperTurns = new Set(upper.sourceTurns);
  return sourceTurns.size === upperTurns.size
    && [...sourceTurns].every((turn) => upperTurns.has(turn));
}

export function promoteIrminsulEntry(memory: IrminsulMemory, entry: IrminsulEntry): IrminsulMemory {
  if (!entry.id.trim()) return memory;
  const current = memory.entries.find((existing) => existing.id === entry.id);
  if (current && JSON.stringify(current) === JSON.stringify(entry)) return memory;
  const withoutTarget = memory.entries.filter((existing) => existing.id !== entry.id);
  const verified = hasVerifiedCoverage(withoutTarget, entry);
  const covered = verified ? new Set(entry.coveredEntryIds) : new Set<string>();
  return normalizeIrminsulMemory({ entries: [...withoutTarget.filter((source) => !covered.has(source.id)), entry] });
}
