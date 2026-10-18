import { expect, it } from 'vitest';
import { planMemoryMaintenance } from '@/core/memory/maintenance';
import { makeMemory, makeSeed } from './fixtures';
it('uses independent short/middle/long thresholds 3/4/5 and preserves real gaps', () => {
  const seed = makeSeed();
  const memories = (['short', 'middle', 'long'] as const).flatMap((layer, index) => Array.from({ length: index + 3 }, (_, i) => makeMemory({ scope: seed.head.scope, memoryId: `${layer}-${i}`, layer, turns: i % 2 ? [5] : [3] })));
  const plan = planMemoryMaintenance({ scope: seed.head.scope, sessionId: seed.head.sessionId, jobId: 'compress-layers', cutoffSeq: 5, memoryRevision: 12, anchorOperationId: 'committed-anchor', mode: 'compress', settings: { shortThreshold: 3, middleThreshold: 4, longThreshold: 5, mode: 'local', prompt: '' }, memories, turns: [] });
  expect(plan.steps.map(step => [step.kind, step.layer, step.memoryRefs.length])).toEqual([['layer', 'middle', 3], ['layer', 'long', 4], ['layer', 'long', 5]]);
  expect(plan.readSet).toHaveLength(12);
  expect(plan.supersededIds).toHaveLength(12);
});
it('does not compress below a threshold or replace pinned/player-edited memories', () => {
  const seed = makeSeed(), memories = Array.from({ length: 4 }, (_, i) => makeMemory({ scope: seed.head.scope, memoryId: `short-${i}`, ...(i === 0 ? { pinned: true } : i === 1 ? { editVersion: 1 } : {}) }));
  const plan = planMemoryMaintenance({ scope: seed.head.scope, sessionId: seed.head.sessionId, jobId: 'below-threshold', cutoffSeq: 1, memoryRevision: 1, anchorOperationId: 'anchor', mode: 'compress', settings: { shortThreshold: 3, middleThreshold: 4, longThreshold: 5, mode: 'local', prompt: '' }, memories, turns: [] });
  expect(plan.steps).toEqual([]); expect(plan.supersededIds).toEqual([]);
});
