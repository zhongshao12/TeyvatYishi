import { expect, it } from 'vitest';
import { auditRecallDataset, evaluateCoreRecall, latencyGateFailures, loadRecallCases, recallGateFailures, type RecallCaseFile } from './recallEvaluation';

const dataset: RecallCaseFile = { kind: 'teyvat-core2-recall-cases', formatVersion: 1, corpus: { turns: 2, slots: [{ slot: 0, actor: 'npc-amber', location: '蒙德城' }, { slot: 1, actor: 'npc-lisa', location: '蒙德城图书馆' }] }, queries: [
  { id: 'tuning-a', split: 'tuning', expect: 'relevant', audience: { target: 'private', npcIds: ['npc-amber'] }, entityIds: ['npc-amber'], locations: ['蒙德城'], query: '第1回合 安柏 苹果', momentTurn: 2, targets: [{ turn: 1, slot: 0 }] },
  { id: 'holdout-b', split: 'holdout', expect: 'relevant', audience: { target: 'private', npcIds: ['npc-amber'] }, entityIds: ['npc-amber'], locations: ['蒙德城'], query: '第2回合 安柏 苹果', momentTurn: 2, targets: [{ turn: 2, slot: 0 }] },
] };

it('identifies shared event identities across tuning and holdout without rewriting the supplied frozen labels', () => {
  const supplied = loadRecallCases(), before = JSON.stringify(supplied), findings = auditRecallDataset(supplied);
  expect(findings.overlappingTargetEvents).toHaveLength(39);
  expect(findings.failures).toContain('CORE2_RECALL_SPLITS_OVERLAP');
  expect(JSON.stringify(supplied)).toBe(before);
});
it('does not allow a bounded slice or fake IndexedDB latency to be presented as a full acceptance pass', async () => {
  const metrics = await evaluateCoreRecall({ corpusTurns: 1, caseFile: dataset });
  expect(metrics.executedCases).toBe(1); expect(metrics.skippedCases).toBe(1); expect(metrics.backend).toBe('fake-indexeddb');
  expect(recallGateFailures(metrics)).toContain('CORE2_RECALL_PARTIAL_COVERAGE');
  expect(latencyGateFailures({ ...metrics, p95StructuredQueryMs: 0 })).toContain('CORE2_LATENCY_REAL_BACKEND_REQUIRED');
});
it('detects private information leaked in an otherwise successful positive query rather than only checking negative queries', async () => {
  const metrics = await evaluateCoreRecall({ corpusTurns: 2, caseFile: dataset }, { retrieve: async request => ({ bundleId: 'injected-knowledge-leak', scope: request.scope, coreSeq: request.head.coreSeq, memoryRevision: request.head.memoryRevision, audience: request.audience,
    mandatory: [], optional: [1, 2].map(turn => ({ kind: 'event' as const, eventId: `event-000${turn}-0`, leafIds: [`event-000${turn}-0`], sourceRefs: [{ sourceId: `source-000${turn}`, sourceVersion: 1 }], text: '安柏赠送苹果', protected: false, reason: 'fixture', rank: { entities: 1, locations: 1, terms: 1, importance: 0, recent: turn, unfinished: 0 } })),
    selectedLeafIds: ['event-0001-0', 'event-0002-0', 'event-0001-1'], completeness: 'complete', rankingVersion: 'structured-lexicographic-v1', indexPosition: { scope: request.scope, status: 'ready', coreSeq: request.head.coreSeq, memoryRevision: 0, indexVersion: 1 }, diagnostics: [] }) });
  expect(metrics.optionalRecallAt8).toBe(1); expect(metrics.unauthorizedSelectedLeafCount).toBe(2);
  expect(recallGateFailures(metrics)).toContain('unauthorizedSelectedLeafCount=2');
});
