// Static audit scanner: writes findings to .audit/report.txt (no stdout capture needed).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = [];
const log = (...a) => OUT.push(a.join(' '));

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', '.audit', 'public', 'assets-src',
  '.pnpm-store', '.tmp-regression', '.tmp-story-weaving-regression',
  '.tmp-story-weaving-persistence-regression', 'src-tauri', '.superpowers',
  '.reasonix', '.trae', '.workbuddy', '.storybook',
]);

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), acc);
    } else acc.push(path.join(dir, e.name));
  }
  return acc;
}

const files = walk(ROOT);
const codeFiles = files.filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts'));
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

log('=== SUMMARY ===');
log('total files scanned:', files.length);
log('ts/tsx code files:', codeFiles.length);

let totalLines = 0;
const info = codeFiles.map((f) => {
  const src = fs.readFileSync(f, 'utf8');
  const lines = src.split('\n');
  totalLines += lines.length;
  return { f, src, lines, n: lines.length };
});
log('total ts/tsx lines:', totalLines);

// ---------- 1. TS suppressions / escape hatches ----------
log('\n=== 1. TYPE ESCAPE HATCHES ===');
const pats = [
  ['@ts-ignore', /@ts-ignore/g],
  ['@ts-expect-error', /@ts-expect-error/g],
  ['@ts-nocheck', /@ts-nocheck/g],
  ['as any', /\bas any\b/g],
  ['as unknown as', /as unknown as/g],
  [': any', /:\s*any\b/g],
  ['<any>', /<any>/g],
  ['eslint-disable', /eslint-disable/g],
  ['non-null !', /\w+!\./g],
  ['TODO/FIXME/HACK/XXX', /\b(TODO|FIXME|HACK|XXX)\b/g],
  ['console.log', /console\.log\(/g],
  ['console.warn', /console\.warn\(/g],
  ['console.error', /console\.error\(/g],
];
for (const [name, re] of pats) {
  const hits = [];
  for (const i of info) {
    const m = i.src.match(re);
    if (m) hits.push({ file: rel(i.f), count: m.length });
  }
  const total = hits.reduce((s, h) => s + h.count, 0);
  hits.sort((a, b) => b.count - a.count);
  log(`\n-- ${name}: ${total} occurrences in ${hits.length} files`);
  for (const h of hits.slice(0, 12)) log(`   ${String(h.count).padStart(4)}  ${h.file}`);
}

// ---------- 2. Duplication: identical normalized function bodies / big blocks ----------
log('\n=== 2. NEAR-DUPLICATE CODE BLOCKS (>=12 identical non-trivial lines) ===');
const blockMap = new Map();
const WINDOW = 12;
for (const i of info) {
  const norm = i.lines.map((l) => l.trim()).filter((l) => l.length > 0);
  for (let k = 0; k + WINDOW <= norm.length; k++) {
    const slice = norm.slice(k, k + WINDOW);
    const meaningful = slice.filter((l) => l.length > 15 && !/^[{}()\[\];,]+$/.test(l));
    if (meaningful.length < WINDOW - 3) continue;
    const key = slice.join('\u0001');
    if (!blockMap.has(key)) blockMap.set(key, []);
    blockMap.get(key).push(rel(i.f));
  }
}
const dupGroups = [];
for (const [key, locs] of blockMap) {
  const uniq = [...new Set(locs)];
  if (uniq.length > 1) dupGroups.push({ key, files: uniq });
}
// collapse overlapping groups: keep groups whose file-set signature is novel
const sigSeen = new Set();
let dupReported = 0;
log('raw duplicate window groups:', dupGroups.length);
for (const g of dupGroups) {
  const sig = g.files.join('|');
  if (sigSeen.has(sig)) continue;
  sigSeen.add(sig);
  if (dupReported++ > 40) break;
  log(`\n  duplicated in [${g.files.join(', ')}]`);
  log('    ' + g.key.split('\u0001').slice(0, 4).join('\n    '));
}

// ---------- 3. File size distribution ----------
log('\n=== 3. FILE SIZE DISTRIBUTION ===');
const buckets = { '<200': 0, '200-500': 0, '500-1000': 0, '1000-2000': 0, '>2000': 0 };
for (const i of info) {
  const n = i.n;
  if (n < 200) buckets['<200']++;
  else if (n < 500) buckets['200-500']++;
  else if (n < 1000) buckets['500-1000']++;
  else if (n < 2000) buckets['1000-2000']++;
  else buckets['>2000']++;
}
for (const [k, v] of Object.entries(buckets)) log(`  ${k.padEnd(12)} ${v} files`);
log('\n  files > 1000 lines:');
for (const i of info.filter((x) => x.n > 1000).sort((a, b) => b.n - a.n)) {
  log(`    ${String(i.n).padStart(5)}  ${rel(i.f)}`);
}

// ---------- 4. Test coverage map ----------
log('\n=== 4. TESTS ===');
const testFiles = files.filter((f) => /\.test\.(ts|tsx)$/.test(f));
log('test files:', testFiles.length);
const testedModules = new Set();
for (const t of testFiles) {
  const src = fs.readFileSync(t, 'utf8');
  for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    let p = m[1];
    if (p.startsWith('@/')) p = p.slice(2);
    testedModules.add(p.replace(/^\//, ''));
  }
}
log('modules referenced by tests:', testedModules.size);
const srcModules = codeFiles.map(rel);
const untested = srcModules.filter((m) => {
  if (/\.test\./.test(m)) return false;
  const base = m.replace(/\.(ts|tsx)$/, '');
  return ![...testedModules].some((t) => {
    const tb = t.replace(/\.(ts|tsx)$/, '');
    return tb === base || tb.endsWith('/' + path.basename(base));
  });
});
log('\n  source modules NOT referenced by any test:', untested.length, '/', srcModules.length);
log('  (top 60 by size)');
const untestedBig = info
  .filter((i) => untested.includes(rel(i.f)))
  .sort((a, b) => b.n - a.n)
  .slice(0, 60);
for (const i of untestedBig) log(`    ${String(i.n).padStart(5)}  ${rel(i.f)}`);

// ---------- 5. Import graph: most depended-upon ----------
log('\n=== 5. FAN-IN (most imported internal modules) ===');
const fanIn = new Map();
for (const i of info) {
  for (const m of i.src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    let p = m[1];
    if (p.startsWith('@/')) p = p.slice(2);
    else if (p.startsWith('.')) p = path.posix.join(path.posix.dirname(rel(i.f)), p);
    else continue;
    p = p.replace(/^\//, '');
    fanIn.set(p, (fanIn.get(p) || 0) + 1);
  }
}
const topFanIn = [...fanIn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 35);
for (const [k, v] of topFanIn) log(`  ${String(v).padStart(4)}  ${k}`);

// ---------- 6. Circular dependency detection ----------
log('\n=== 6. POTENTIAL CIRCULAR DEPENDENCIES ===');
const graph = new Map();
const resolveMod = (fromFile, spec) => {
  let p = spec;
  if (p.startsWith('@/')) p = p.slice(2);
  else if (p.startsWith('.')) p = path.posix.join(path.posix.dirname(rel(fromFile)), p);
  else return null;
  p = p.replace(/^\//, '');
  for (const cand of [p + '.ts', p + '.tsx', p + '/index.ts', p + '/index.tsx', p]) {
    if (fs.existsSync(path.join(ROOT, cand))) return cand;
  }
  return null;
};
for (const i of info) {
  const deps = [];
  for (const m of i.src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const r = resolveMod(i.f, m[1]);
    if (r) deps.push(r);
  }
  graph.set(rel(i.f), deps);
}
const cycles = [];
const state = new Map();
const stack = [];
function dfs(node) {
  if (state.get(node) === 1) {
    const idx = stack.indexOf(node);
    if (idx >= 0) cycles.push(stack.slice(idx).concat(node));
    return;
  }
  if (state.get(node) === 2) return;
  state.set(node, 1);
  stack.push(node);
  for (const d of graph.get(node) || []) dfs(d);
  stack.pop();
  state.set(node, 2);
}
for (const n of graph.keys()) dfs(n);
const uniqCycles = [];
const seenCycle = new Set();
for (const c of cycles) {
  const key = [...c].sort().join('|');
  if (seenCycle.has(key)) continue;
  seenCycle.add(key);
  uniqCycles.push(c);
}
log('distinct circular chains found:', uniqCycles.length);
for (const c of uniqCycles.slice(0, 30)) log('  ' + c.join(' -> '));

// ---------- 7. React performance smells ----------
log('\n=== 7. REACT PERFORMANCE SMELLS ===');
const reactPats = [
  ['inline arrow in JSX prop', /=\{[^}]*=>[^}]*\}/g],
  ['useMemo', /useMemo\(/g],
  ['useCallback', /useCallback\(/g],
  ['React.memo', /React\.memo|memo\(/g],
  ['useEffect', /useEffect\(/g],
  ['useState', /useState[<(]/g],
  ['useRef', /useRef[<(]/g],
  ['createPortal', /createPortal\(/g],
  ['index as key', /key=\{i\}|key=\{index\}/g],
  ['JSON.parse', /JSON\.parse\(/g],
  ['JSON.stringify', /JSON\.stringify\(/g],
  ['structuredClone', /structuredClone\(/g],
  ['localStorage', /localStorage\./g],
  ['indexedDB', /indexedDB\./g],
  ['setInterval', /setInterval\(/g],
  ['setTimeout', /setTimeout\(/g],
  ['addEventListener', /addEventListener\(/g],
  ['fetch(', /\bfetch\(/g],
];
for (const [name, re] of reactPats) {
  let total = 0;
  const hits = [];
  for (const i of info) {
    const m = i.src.match(re);
    if (m) { total += m.length; hits.push({ file: rel(i.f), count: m.length }); }
  }
  hits.sort((a, b) => b.count - a.count);
  log(`\n-- ${name}: ${total}`);
  for (const h of hits.slice(0, 6)) log(`   ${String(h.count).padStart(4)}  ${h.file}`);
}

// ---------- 8. localStorage / persistence without try-catch ----------
log('\n=== 8. UNGUARDED PERSISTENCE CALLS ===');
for (const i of info) {
  const lines = i.lines;
  for (let k = 0; k < lines.length; k++) {
    if (/JSON\.parse\((localStorage|sessionStorage)|JSON\.parse\([^)]*getItem/.test(lines[k])) {
      const ctx = lines.slice(Math.max(0, k - 6), k + 3).join('\n');
      if (!/try\s*\{/.test(ctx)) log(`  ${rel(i.f)}:${k + 1}  ${lines[k].trim().slice(0, 110)}`);
    }
  }
}

// ---------- 9. API key / secret handling ----------
log('\n=== 9. SECRET HANDLING ===');
const secretPats = [
  ['apiKey literal-ish', /apiKey\s*[:=]\s*['"][^'"]{8,}/g],
  ['Authorization header', /Authorization/g],
  ['Bearer', /Bearer /g],
  ['sk- token', /sk-[A-Za-z0-9]{10,}/g],
  ['btoa/base64 secret', /btoa\(/g],
  ['crypto.subtle', /crypto\.subtle/g],
  ['obfuscate', /obfuscate|encrypt|decrypt/gi],
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/g],
  ['innerHTML', /innerHTML/g],
  ['eval', /\beval\(/g],
  ['new Function', /new Function\(/g],
];
for (const [name, re] of secretPats) {
  let total = 0;
  const hits = [];
  for (const i of info) {
    const m = i.src.match(re);
    if (m) { total += m.length; hits.push({ file: rel(i.f), count: m.length }); }
  }
  hits.sort((a, b) => b.count - a.count);
  log(`\n-- ${name}: ${total}`);
  for (const h of hits.slice(0, 5)) log(`   ${String(h.count).padStart(4)}  ${h.file}`);
}

// ---------- 10. Error handling quality ----------
log('\n=== 10. ERROR HANDLING ===');
let emptyCatch = 0;
const emptyCatchFiles = [];
for (const i of info) {
  const m = i.src.match(/catch\s*(\([^)]*\))?\s*\{\s*\}/g);
  if (m) { emptyCatch += m.length; emptyCatchFiles.push(`${m.length}  ${rel(i.f)}`); }
}
log('empty catch blocks:', emptyCatch);
for (const f of emptyCatchFiles.slice(0, 15)) log('   ' + f);

// swallow: catch that only console.logs
let consoleOnly = 0;
for (const i of info) {
  const m = i.src.match(/catch\s*(\([^)]*\))?\s*\{\s*console\.(log|warn|error)\([^;]*\);\s*\}/g);
  if (m) consoleOnly += m.length;
}
log('catch blocks that only console.* :', consoleOnly);

// ---------- 11. Accessibility ----------
log('\n=== 11. ACCESSIBILITY ===');
const a11yPats = [
  ['onClick on div/span', /<(div|span)[^>]*onClick/g],
  ['button without type', /<button(?![^>]*type=)[^>]*>/g],
  ['img without alt', /<img(?![^>]*alt=)[^>]*>/g],
  ['aria-* usage', /aria-[a-z]+=/g],
  ['role=', /role=/g],
  ['tabIndex', /tabIndex=/g],
  ['htmlFor', /htmlFor=/g],
  ['onKeyDown', /onKeyDown=/g],
];
for (const [name, re] of a11yPats) {
  let total = 0;
  const hits = [];
  for (const i of info.filter((x) => /\.tsx$/.test(x.f))) {
    const m = i.src.match(re);
    if (m) { total += m.length; hits.push({ file: rel(i.f), count: m.length }); }
  }
  hits.sort((a, b) => b.count - a.count);
  log(`\n-- ${name}: ${total}`);
  for (const h of hits.slice(0, 5)) log(`   ${String(h.count).padStart(4)}  ${h.file}`);
}

// ---------- 12. Generated / vendored artifacts committed ----------
log('\n=== 12. LARGE / GENERATED FILES ===');
for (const f of files) {
  const st = fs.statSync(f);
  if (st.size > 200 * 1024) log(`  ${(st.size / 1024).toFixed(0).padStart(8)} KB  ${rel(f)}`);
}

fs.mkdirSync(path.join(ROOT, '.audit'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.audit', 'report.txt'), OUT.join('\n'), 'utf8');
