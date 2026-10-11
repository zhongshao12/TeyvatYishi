import { hasVerifiedIrminsulCoverage, normalizeIrminsulMemory, type IrminsulEntry, type IrminsulMemory } from '@/models/teyvat/irminsul';
export { hasCompleteIrminsulSourceCoverage } from '@/models/teyvat/irminsul';

export function getActiveIrminsulEntries(memory: IrminsulMemory): IrminsulEntry[] {
  return memory.entries.filter((entry) => entry.status !== 'pending');
}

export function promoteIrminsulEntry(memory: IrminsulMemory, entry: IrminsulEntry): IrminsulMemory {
  if (!entry.id.trim()) return memory;
  const current = memory.entries.find((existing) => existing.id === entry.id);
  if (current && JSON.stringify(current) === JSON.stringify(entry)) return memory;
  const withoutTarget = memory.entries.filter((existing) => existing.id !== entry.id);
  const verified = hasVerifiedIrminsulCoverage(withoutTarget, entry);
  const covered = verified ? new Set(entry.coveredEntryIds) : new Set<string>();
  return normalizeIrminsulMemory({ entries: [...withoutTarget.filter((source) => !covered.has(source.id)), entry] });
}
