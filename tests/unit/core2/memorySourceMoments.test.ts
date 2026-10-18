import { expect, it, vi } from 'vitest';
import { buildCoreMemory } from '@/core/memory/memoryRecords';
import { makeSeed, makeSource, makeCommit } from './fixtures';
it('retains source start and actual committed end, including date, world, weather, location and travel days', () => {
  const seed = makeSeed(), batch = makeCommit(seed.head);
  const source = makeSource({ scope: seed.head.scope, ref: batch.sourceRefs[0]!, moment: { ...seed.sources[0]!.moment, clock: '23:30', turn: 3 } });
  const end = { ...source.moment, date: '旅行历 1000.03.08', clock: '02:30', travelDay: 2, weather: '雨', location: '风起地' };
  const event = { ...batch.events[0]!, occurredMoment: end, commitSeq: 1, turn: 3 };
  const memory = buildCoreMemory({ scope: seed.head.scope, memoryId: 'moment-memory', text: '夜间赶路。', layer: 'short', sources: [source], events: [event], mode: 'local' });
  expect(memory.momentRange.start).toEqual(source.moment); expect(memory.momentRange.end).toEqual(end);
  expect(memory.turns).toEqual([3]); expect(memory.locations).toEqual(['蒙德城', '风起地']);
  expect(memory.sourceRefs).toEqual([source.ref]);
});
it('preserves real gaps instead of fabricating continuous turn coverage and never reads the computer clock', () => {
  const seed = makeSeed(), batch = makeCommit(seed.head), clock = vi.spyOn(Date, 'now');
  const source = makeSource({ scope: seed.head.scope, ref: batch.sourceRefs[0]! });
  const events = [3, 5].map(turn => ({ ...batch.events[0]!, eventId: `event-${turn}`, turn, occurredMoment: { ...source.moment, turn }, commitSeq: turn }));
  expect(buildCoreMemory({ scope: seed.head.scope, memoryId: 'gap-memory', text: '两次冒险。', layer: 'middle', sources: [source], events, mode: 'local' }).turns).toEqual([3, 5]);
  expect(clock).not.toHaveBeenCalled(); clock.mockRestore();
});
