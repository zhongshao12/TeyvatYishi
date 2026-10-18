// M09 gate: evaluates the frozen recall case file against the real retrieval path.
// Usage:
//   node scripts/core2-recall-evaluation.mjs                 (reviewed, source-disjoint 160-query dataset)
//   node scripts/core2-recall-evaluation.mjs --legacy-cases  (retained DeepSeek dataset; audit correctly rejects overlap)
//   node scripts/core2-recall-evaluation.mjs --turns=40 --slice (contract-only slice, never full acceptance)
// Real-backend latency is not available from this Node/fake-indexeddb entry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = process.cwd();
const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const prefix = `--${name}=`;
  const found = args.find(argument => argument.startsWith(prefix));
  return found === undefined ? fallback : found.slice(prefix.length);
};
const turns = Number(readFlag('turns', '120'));
const assertLatency = args.includes('--latency');
const slice = args.includes('--slice');
const legacyCases = args.includes('--legacy-cases') || slice || args.some(argument => argument.startsWith('--turns='));
const scenariosV2 = args.includes('--scenarios-v2') || !legacyCases;
assert.ok(args.every(argument => ['--slice', '--latency', '--legacy-cases', '--scenarios-v2'].includes(argument) || argument.startsWith('--turns=')), 'CORE2_RECALL_UNKNOWN_OPTION');
assert.ok(Number.isSafeInteger(turns) && turns > 0, '--turns must be a positive integer');
assert.ok(!assertLatency, 'CORE2_LATENCY_REAL_BACKEND_REQUIRED: this entry uses fake-indexeddb');
assert.ok(!scenariosV2 || !legacyCases, 'CORE2_SCENARIO_FULL_RUN_ONLY: --scenarios-v2 cannot be mixed with legacy options');

const outdir = path.join(root, '.tmp-core2-validation', 'core2-recall-evaluation');
fs.mkdirSync(outdir, { recursive: true });
const outfile = path.join(outdir, `recall-evaluation-${process.pid}.mjs`);
const bundled = await build({
  stdin: {
    contents: [
      "export { evaluateCoreRecall, recallGateFailures, latencyGateFailures, loadRecallCases, auditRecallDataset } from './tests/unit/core2/recallEvaluation.ts';",
      "export { evaluateScenarioRecall, scenarioRecallFailures } from './tests/unit/core2/scenarioRecallEvaluation.ts';",
      "export { makeNodeRepository } from './tests/unit/core2/nodeCorpusSession.ts';",
    ].join('\n'),
    resolveDir: root,
    sourcefile: 'core2-recall-evaluation-entry.ts',
    loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent',
  alias: { '@': root },
});
fs.writeFileSync(outfile, bundled.outputFiles[0].text);
let module;
try {
  module = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);
} finally {
  fs.rmSync(outfile, { force: true });
}
const { evaluateCoreRecall, recallGateFailures, loadRecallCases, auditRecallDataset } = module;

if (scenariosV2) {
  const metrics = await module.evaluateScenarioRecall(module.makeNodeRepository(`test-core2-scenarios-v2-${crypto.randomUUID()}`));
  const failures = module.scenarioRecallFailures(metrics);
  console.log(JSON.stringify({ kind: 'teyvat-core2-scenario-recall', acceptanceScope: 'synthetic-recall-quality-only', acceptancePassed: failures.length === 0,
    reviewedBy: 'Codex, explicitly delegated by user; not independent human annotation',
    device: { node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model, memoryGiB: Math.round(os.totalmem() / 1024 ** 3) }, metrics, failures }, null, 2));
  process.exit(failures.length ? 1 : 0);
}

const file = loadRecallCases();
const datasetAudit = auditRecallDataset(file);
if (!slice && datasetAudit.failures.length) {
  console.log(JSON.stringify({ kind: 'teyvat-core2-recall-evaluation', status: 'blocked_by_dataset_audit', backend: 'fake-indexeddb', acceptancePassed: false, datasetAudit }, null, 2));
  process.exit(1);
}
const started = Date.now();
const metrics = await evaluateCoreRecall({ corpusTurns: turns });
const failures = recallGateFailures(metrics, { mode: slice ? 'contract-slice' : 'acceptance' });
const report = {
  kind: 'teyvat-core2-recall-evaluation',
  formatVersion: 1,
  scope: slice ? 'contract-slice' : 'acceptance', backend: metrics.backend, acceptancePassed: !slice && failures.length === 0, datasetAudit,
  generatedAt: new Date().toISOString(),
  ranAt: { node: process.version, platform: process.platform, arch: process.arch, cpu: metrics.device.cpu, memoryGiB: metrics.device.memoryGiB },
  caseFile: { queries: file.queries.length, corpusTurns: file.corpus.turns },
  evaluated: { corpusTurns: metrics.corpusTurns, declaredCases: metrics.caseCount, cases: metrics.executedCases, positives: metrics.executedPositives, negatives: metrics.executedNegatives, skipped: metrics.skippedCases, samples: metrics.querySamples },
  metrics: {
    optionalRecallAt8: metrics.optionalRecallAt8, tuningRecallAt8: metrics.tuningRecallAt8, holdoutRecallAt8: metrics.holdoutRecallAt8,
    unauthorizedSelectedLeafCount: metrics.unauthorizedSelectedLeafCount, missingTargetCount: metrics.missingTargetCount,
    unresolvableImportantSources: metrics.unresolvableImportantSources, duplicateSelectedLeaves: metrics.duplicateSelectedLeaves,
    indexColdStartMs: metrics.indexColdStartMs, p95StructuredQueryMs: metrics.p95StructuredQueryMs, maxStructuredQueryMs: metrics.maxStructuredQueryMs,
    rankingVersion: metrics.rankingVersion, totalMs: Date.now() - started,
  },
  negatives: file.queries.filter(row => row.expect === 'unauthorized').length,
  positives: file.queries.filter(row => row.expect === 'relevant').length,
  failures,
  worst: metrics.failures.slice(0, 10),
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) { console.error(`✗ recall evaluation failed: ${failures.join('; ')}`); process.exit(1); }
console.log(slice ? '✓ contract slice passed; NOT full acceptance (dataset qualification and coverage are separate)' : '✓ core2 recall correctness evaluation passed; real-backend performance is separate');
