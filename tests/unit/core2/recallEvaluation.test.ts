import { expect, it } from 'vitest';
import { evaluateCoreRecall, loadRecallCases, recallGateFailures } from './recallEvaluation';

it('keeps the committed case file balanced and frozen', () => {
  const file = loadRecallCases();
  expect(file.queries).toHaveLength(160);
  expect(file.queries.filter(row => row.expect === 'relevant')).toHaveLength(120);
  expect(file.queries.filter(row => row.expect === 'unauthorized')).toHaveLength(40);
  expect(file.queries.filter(row => row.split === 'tuning')).toHaveLength(80);
  expect(file.queries.filter(row => row.split === 'holdout')).toHaveLength(80);
  const targets = file.queries.filter(row => row.expect === 'relevant').reduce((sum, row) => sum + row.targets.length, 0);
  expect(targets).toBeGreaterThanOrEqual(120);
  for (const row of file.queries) {
    expect(row.targets.length).toBeGreaterThanOrEqual(1);
    expect(row.targets.length).toBeLessThanOrEqual(4);
  }
});

it('checks recall and authorization on a bounded draft corpus without claiming full acceptance or real backend latency', async () => {
  const metrics = await evaluateCoreRecall({ corpusTurns: 20 });
  expect(metrics.eventCount).toBe(80);
  expect(metrics.skippedCases).toBeGreaterThan(0);
  expect(metrics.querySamples).toBeGreaterThanOrEqual(15);
  expect(metrics.unauthorizedSelectedLeafCount).toBe(0);
  expect(metrics.missingTargetCount).toBe(0);
  expect(metrics.unresolvableImportantSources).toBe(0);
  expect(metrics.duplicateSelectedLeaves).toBe(0);
  expect(metrics.optionalRecallAt8).toBeGreaterThanOrEqual(0.9);
  expect(metrics.holdoutRecallAt8).toBeGreaterThanOrEqual(0.9);
  expect(recallGateFailures(metrics, { mode: 'contract-slice' })).toEqual([]);
  expect(recallGateFailures(metrics)).toContain('CORE2_RECALL_PARTIAL_COVERAGE');
  expect(recallGateFailures(metrics)).toContain('CORE2_RECALL_SPLITS_OVERLAP');
  // Latency is reported, not asserted: fake-indexeddb timings are not the real browser gate.
  expect(metrics.p95StructuredQueryMs).toBeGreaterThan(0);
}, 300_000);
