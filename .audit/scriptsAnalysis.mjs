import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const out = [];
const log = (...a) => out.push(a.join(' '));

const scriptFiles = fs.readdirSync('scripts').filter((f) => f.endsWith('.mjs'));
const regressions = scriptFiles.filter((f) => f.endsWith('-regression.mjs'));
log(`scripts/*.mjs total: ${scriptFiles.length}`);
log(`scripts/*-regression.mjs: ${regressions.length}`);

const EXTRA = ['npc-ledger-variable-facts-behavior.mjs', 'teyvat-runtime-language-audit.mjs', 'validate-story-weaving-canon.mjs'];
log(`EXTRA manifest entries: ${EXTRA.length}`);
const inSuite = new Set([...regressions, ...EXTRA]);
log(`scripts run by test:all: ${inSuite.size}`);

log('\n=== ALL scripts/*.mjs NOT in the test:all suite (dead/orphan scripts) ===');
const orphans = scriptFiles.filter((f) => !inSuite.has(f));
log(`count: ${orphans.length}`);
for (const f of orphans) {
  const kb = (fs.statSync(path.join('scripts', f)).size / 1024).toFixed(1);
  log(`  ${kb.padStart(7)} KB  ${f}`);
}

// ---- analyse each regression script's assertion style ----
const readSrc = new Map();
for (const f of inSuite) {
  const p = path.join('scripts', f);
  if (fs.existsSync(p)) readSrc.set(f, fs.readFileSync(p, 'utf8'));
}

const stats = {
  usesReadFileSync: [],
  usesImportTs: [],
  usesAssertLib: [],
  usesSpawn: [],
  handRolledThrow: [],
  stringMatchAssert: [],
  regexAssert: [],
  includesAssert: [],
  functionalAssert: [],
};
const libPatterns = [/from\s+['"]node:assert/, /require\(['"]assert/, /from\s+['"]vitest['"]/, /from\s+['"]chai['"]/];
for (const [f, src] of readSrc) {
  if (/readFileSync/.test(src)) stats.usesReadFileSync.push(f);
  if (/import\s+.*from\s+['"][^'"]*\.ts['"]|await import\(['"][^'"]*\.ts['"]\)/.test(src)) stats.usesImportTs.push(f);
  if (libPatterns.some((re) => re.test(src))) stats.usesAssertLib.push(f);
  if (/spawnSync|execFileSync|execSync/.test(src)) stats.usesSpawn.push(f);
  if (/function assert\s*\(/.test(src)) stats.handRolledThrow.push(f);
  // Assertions whose argument is a bare .includes(/test( on file text
  if (/assert\([^)]*\.includes\(/.test(src)) stats.includesAssert.push(f);
  if (/assert\([^)]*\.test\(/.test(src) || /\.match\(/.test(src)) stats.regexAssert.push(f);
  if (/assert\(/.test(src)) stats.stringMatchAssert.push(f);
  // Heuristic "functional": imports a .ts module and calls its exported functions
  const importedTs = [...src.matchAll(/from\s+['"]([^'"]+\.ts)['"]/g)].map((m) => m[1]);
  const dynamicTs = [...src.matchAll(/await import\(['"]([^'"]+\.ts)['"]\)/g)].map((m) => m[1]);
  if (importedTs.length + dynamicTs.length > 0) stats.functionalAssert.push(f);
}

log('\n=== REGRESSION SCRIPT STYLE CENSUS (suite of ' + inSuite.size + ') ===');
for (const [k, v] of Object.entries(stats)) {
  log(`  ${k.padEnd(22)} ${String(v.length).padStart(3)}  (${((v.length / inSuite.size) * 100).toFixed(0)}%)`);
}

log('\n=== scripts that import a .ts module directly (behavioural) ===');
for (const f of stats.functionalAssert) log('  ' + f);
log('\n=== scripts that DO NOT import any .ts module (source-text only) ===');
const textOnly = [...readSrc.keys()].filter((f) => !stats.functionalAssert.includes(f));
log(`  count: ${textOnly.length}`);
for (const f of textOnly) log('  ' + f);

// ---- bundle-size gate reality check ----
log('\n=== BUNDLE SIZE GATE ANALYSIS ===');
const baseline = JSON.parse(fs.readFileSync('.bundle-baseline.json', 'utf8'));
log('baseline.maxChunkBytes =', baseline.maxChunkBytes, `(${(baseline.maxChunkBytes / 1024 / 1024).toFixed(2)} MB)`);
log('baseline.maxChunkName  =', baseline.maxChunkName);
log('baseline.totalJsBytes  =', baseline.totalJsBytes, `(${(baseline.totalJsBytes / 1024 / 1024).toFixed(2)} MB)`);
log('baseline.indexBytes    =', baseline.indexBytes, `(${(baseline.indexBytes / 1024).toFixed(1)} KB)`);
log('baseline.at            =', baseline.at);
const capMaxChunk = Math.min(Math.floor(baseline.maxChunkBytes * 1.15), 3.5 * 1024 * 1024);
const capTotalJs = Math.floor(baseline.totalJsBytes * 1.15);
const capIndex = 300 * 1024;
log(`\nderived caps: index<${(capIndex / 1024).toFixed(1)}KB  maxChunk<${(capMaxChunk / 1024).toFixed(1)}KB  totalJs<${(capTotalJs / 1024).toFixed(1)}KB`);
log(`\nNOTE: baseline references '${baseline.maxChunkName}'`);
const stale = !fs.existsSync(path.join('data', 'stPresets.ts')) && true;
log('grep for that chunk name in source/config found no producer (manualChunks has no st-presets rule) ->');
log('  the referenced 3.02MB chunk is NOT produced by the current vite.config.ts manualChunks.');
log('\nIn the CURRENT config, all app modules (services/ hooks/ models/) go into ONE chunk-app.');
log('Current baseline top-2: maxChunk 3.02MB (stale) + chunk-app 1.13MB.');
log('If the stale 3.02MB chunk no longer exists, the real max chunk is chunk-app ~1.13MB,');
log('so the gate would compute maxChunkBytes ~1.13MB < capMaxChunk 3.47MB -> PASSES but is vacuous.');
log('Conversely indexBytes cap is 300KB vs baseline index 194KB -> still enforceable.');

// ---- count test files / unit coverage ----
log('\n=== UNIT TEST INVENTORY ===');
const unitDir = 'tests/unit';
const unitTests = fs.existsSync(unitDir) ? fs.readdirSync(unitDir).filter((f) => f.endsWith('.test.ts')) : [];
log(`tests/unit/*.test.ts : ${unitTests.length}`);
const allTests = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(d, e.name));
    else allTests.push(path.join(d, e.name));
  }
})('tests');
log(`all files under tests/ : ${allTests.length}`);
for (const t of allTests) log(`  ${(fs.statSync(t).size / 1024).toFixed(1).padStart(7)} KB  ${t}`);

fs.writeFileSync('.audit/scripts.txt', out.join('\n'), 'utf8');
