// M09 gate: synthetic long sessions against the real repository contract.
// Usage:
//   node scripts/core2-long-session-regression.mjs                     (100 turns, fast contract check)
//   node scripts/core2-long-session-regression.mjs --turns=1000        (one scale per process)
//   node scripts/core2-long-session-regression.mjs --turns=5000 --images=100
// Node/fake-indexeddb only proves the contract; real browser and desktop timings are measured separately.
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
const turns = readFlag('turns', '100').split(',').map(value => Number(value.trim()));
assert.ok(turns.length > 0 && turns.every(value => Number.isSafeInteger(value) && value > 0), '--turns must be a comma separated list of positive integers');
assert.equal(turns.length, 1, 'CORE2_ONE_SCALE_PER_PROCESS: run each scale in its own process');
const images = Number(readFlag('images', '0'));
const skipIndex = args.includes('--skip-index');
assert.ok(Number.isSafeInteger(images) && images >= 0, '--images must be a non-negative integer');

const outdir = path.join(root, '.tmp-core2-validation', 'core2-long-session');
fs.mkdirSync(outdir, { recursive: true });
const outfile = path.join(outdir, `long-session-${process.pid}.mjs`);
const bundled = await build({
  stdin: {
    contents: "export { runCoreLongSession, longSessionGateFailures } from './tests/unit/core2/longSession.ts';",
    resolveDir: root,
    sourcefile: 'core2-long-session-regression-entry.ts',
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
const { runCoreLongSession, longSessionGateFailures } = module;

const runs = [];
const failures = [];
for (const count of turns) {
  const metrics = await runCoreLongSession({ turns: count, images: count >= 5000 ? images : Math.min(images, 10), skipIndex });
  const runFailures = longSessionGateFailures(metrics);
  runs.push({ ...metrics, failures: runFailures });
  failures.push(...runFailures.map(failure => `${count} turns: ${failure}`));
  console.log(JSON.stringify({
    kind: 'teyvat-core2-long-session-run', formatVersion: 1, generatedAt: new Date().toISOString(), ...metrics, failures: runFailures,
  }, null, 2));
}
console.log(JSON.stringify({ kind: 'teyvat-core2-long-session', formatVersion: 1, runs: runs.length, turns, images, skipIndex, failures, summary: runs.map(run => ({
  turns: run.turns, events: run.events, buildMs: run.buildMs, turnsPerSecond: run.turnsPerSecond, readStateMs: run.readStateMs,
  firstSourceReadMs: run.firstSourceReadMs, recoveryCommits: run.recoveryCommits, duplicateEffects: run.duplicateEffects,
  indexBuildMs: run.indexBuildMs, indexStatus: run.indexStatus, p95PostingQueryMs: run.p95PostingQueryMs, stateBytes: run.stateBytes,
  endHeapMB: run.endHeapMB, postingHits: run.postingHits, measurementScope: run.measurementScope,
})) }, null, 2));
if (failures.length) { console.error(`✗ long session gates failed: ${failures.join('; ')}`); process.exit(1); }
console.log('✓ core2 ledger-only subchecks passed; full M09 workload/real-backend acceptance is NOT established' + (skipIndex ? '; indexing and queries were SKIPPED' : ''));
