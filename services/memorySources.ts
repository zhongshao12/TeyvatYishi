import type { 聊天消息 } from '@/models/chat';
import type { MemoryMaintenanceState, MemorySourceItem } from '@/models/memorySource';
import type { WorldMomentRange } from '@/models/teyvat/worldMoment';
import { normalizeSourceTurns } from '@/models/memorySource';
import { normalizeWorldMoment, normalizeWorldMomentRange } from './worldMoment';
export { fingerprintMemoryText } from '@/models/memorySource';

export function readMemorySourceItems({ memory, irminsul }: MemoryMaintenanceState): MemorySourceItem[] {
  const layers = [
    ['immediate', memory.即时记忆, memory.即时记忆ID],
    ['short', memory.短期记忆, memory.短期归档ID],
    ['middle', memory.中期记忆, memory.中期归档ID],
    ['long', memory.长期记忆, memory.长期归档ID],
  ] as const;
  const idCounts = new Map<string, number>();
  const archiveById = new Map<string, typeof irminsul.entries>();
  for (const entry of irminsul.entries) {
    const matches = archiveById.get(entry.id);
    if (matches) matches.push(entry);
    else archiveById.set(entry.id, [entry]);
  }
  for (const [, texts, ids] of layers) texts.forEach((_, index) => {
    const id = ids?.[index];
    if (id?.trim()) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  });
  return layers.flatMap(([layer, texts, ids]) => texts.map((text, index): MemorySourceItem => {
    const candidate = ids?.[index];
    const id = candidate?.trim() && idCounts.get(candidate) === 1 ? candidate : null;
    const matches = id ? archiveById.get(id) ?? [] : [];
    const archive = matches.length === 1 && matches[0]?.summary === text
      && matches[0]?.archiveType === (layer === 'middle' ? 'medium' : layer) ? matches[0] : undefined;
    const explicitTurns = id ? memory.来源回合?.[id] : undefined;
    const turns = normalizeSourceTurns(explicitTurns ?? archive?.sourceTurns);
    // Conflicting associations are never authorization to replace a source.
    const sourceTurns = (matches.length > 0 && !archive)
      || (archive && explicitTurns && JSON.stringify(turns) !== JSON.stringify(normalizeSourceTurns(archive.sourceTurns))) ? [] : turns;
    const momentRange = id ? normalizeWorldMomentRange(memory.来源时刻?.[id] ?? archive?.sourceMomentRange) : null;
    return {
      id, layer, text, sourceTurns,
      sourceMessageIds: [...(momentRange?.sourceIds ?? [])],
      sourceEntryIds: archive ? [...(archive.coveredEntryIds ?? [])] : [],
      momentRange,
      generatedFingerprint: id ? memory.生成文本指纹?.[id] ?? null : null,
    };
  }));
}
export function resolveRebuildTurnMoment(turn: number, message: 聊天消息, state: MemoryMaintenanceState): WorldMomentRange | null {
  const direct = normalizeWorldMoment(message.worldMoment);
  if (direct?.turn === turn) return { start: direct, end: direct, sourceIds: [message.id] };
  const candidates = [
    ...readMemorySourceItems(state).map(item => ({ turns: item.sourceTurns, range: item.momentRange })),
    ...state.irminsul.entries.map(entry => ({ turns: normalizeSourceTurns(entry.sourceTurns), range: normalizeWorldMomentRange(entry.sourceMomentRange) })),
  ].filter(({ turns, range }) => turns.length === 1 && turns[0] === turn && range?.start?.turn === turn
    && range.end?.turn === turn && JSON.stringify(range.start) === JSON.stringify(range.end));
  const first = candidates[0]?.range;
  if (!first || candidates.some(item => JSON.stringify(item.range?.start) !== JSON.stringify(first.start))) return null;
  return { ...first, sourceIds: [...new Set(candidates.flatMap(item => item.range?.sourceIds ?? []))] };
}
