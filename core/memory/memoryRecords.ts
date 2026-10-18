import type { WorldMoment } from '@/models/teyvat/worldMoment';
import type { CoreScope } from '../contracts/identity';
import type { GameEvent, SourceRecord } from '../contracts/event';
import type { MemoryLayer, MemoryRecord } from '../contracts/memory';
import { validateCoreDto } from '../contracts/validation';
import { travelDateOrdinal, worldClockMinutes } from '../contracts/worldClock';
import { sourceRefKey } from '../persistence/repositoryValidation';

export interface MemoryBuildInput { scope: CoreScope; memoryId: string; text: string; layer: MemoryLayer; sources: SourceRecord[]; events: GameEvent[]; memories?: MemoryRecord[]; mode: MemoryRecord['generation']['mode']; version?: number; editVersion?: number; pinned?: boolean }
function compareMoment(a: WorldMoment, b: WorldMoment): number {
  return a.turn - b.turn || (travelDateOrdinal(a.date) ?? 0) - (travelDateOrdinal(b.date) ?? 0) || (worldClockMinutes(a.clock) ?? 0) - (worldClockMinutes(b.clock) ?? 0);
}
/** Metadata is derived from actual sources/commits, never from generated prose or wall time. */
export function buildCoreMemory(input: MemoryBuildInput): MemoryRecord {
  const { scope, sources, events } = structuredClone(input), previous = structuredClone(input.memories ?? []);
  if (!input.text.trim() || sources.some(source => !validateCoreDto('source', source).ok || source.scope.journeyId !== scope.journeyId)
    || events.some(event => !validateCoreDto('event', event).ok || event.journeyId !== scope.journeyId)
    || previous.some(memory => !validateCoreDto('memory', memory).ok || memory.scope.journeyId !== scope.journeyId)) throw Error('CORE2_MEMORY_PROVENANCE_INVALID');
  const refs = new Map([...sources.map(source => source.ref), ...previous.flatMap(memory => memory.sourceRefs)].map(ref => [sourceRefKey(ref), ref]));
  const moments = [...sources.map(source => source.moment), ...events.map(event => event.occurredMoment), ...previous.flatMap(memory => [memory.momentRange.start, memory.momentRange.end].filter((moment): moment is WorldMoment => !!moment))].sort(compareMoment);
  const visibilities = [...events.map(event => event.visibility), ...previous.map(memory => memory.visibility)];
  const intersection = visibilities.length ? visibilities[0]!.npcIds.filter(id => visibilities.every(visibility => visibility.npcIds.includes(id))) : [];
  const memory: MemoryRecord = {
    memoryId: input.memoryId, scope, version: input.version ?? 1, layer: input.layer, text: input.text.trim(), sourceRefs: [...refs.values()],
    eventIds: [...new Set([...events.filter(event => event.type !== 'turn.complete').map(event => event.eventId), ...previous.flatMap(memory => memory.eventIds)])],
    memoryRefs: previous.map(memory => ({ memoryId: memory.memoryId, version: memory.version })),
    turns: [...new Set([...events.map(event => event.turn), ...previous.flatMap(memory => memory.turns)])].sort((a, b) => a - b),
    momentRange: { start: moments[0] ?? null, end: moments.at(-1) ?? null, sourceIds: [...new Set([...refs.values()].map(ref => ref.sourceId))] },
    // Speaker IDs are search tags only, never a grant of historical knowledge.
    npcIds: [...new Set([...visibilities.flatMap(visibility => visibility.npcIds), ...sources.flatMap(source => source.blocks.flatMap(block => block.speakerId ? [block.speakerId] : [])), ...previous.flatMap(memory => memory.npcIds)])],
    locations: [...new Set(moments.flatMap(moment => moment.location ? [moment.location] : []))],
    visibility: { kind: visibilities.length > 0 && visibilities.every(visibility => visibility.kind === 'public') ? 'public' : intersection.length ? 'participants' : 'private', npcIds: intersection },
    importance: events.some(event => event.fact?.kind === 'commitment') ? 10 : Math.max(1, ...previous.map(memory => memory.importance)),
    pinned: input.pinned ?? false, status: 'active', generation: { mode: input.mode, version: 'core2-memory-v1' }, editVersion: input.editVersion ?? 0,
  };
  if (!validateCoreDto('memory', memory).ok) throw Error('CORE2_MEMORY_RECORD_INVALID');
  return memory;
}
