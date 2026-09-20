import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const out = [];
const log = (...a) => out.push(a.join(' '));

const SKIP = new Set(['node_modules', '.git', 'dist', '.audit', 'public', 'assets-src', '.pnpm-store', 'src-tauri', '.tmp-regression', '.tmp-story-weaving-regression', '.tmp-story-weaving-persistence-regression']);
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(dir, e.name), acc); }
    else acc.push(path.join(dir, e.name));
  }
  return acc;
}
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const files = walk(ROOT).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts'));

// ---- duplicate top-level function/const names across files ----
log('=== 1. SAME TOP-LEVEL FUNCTION NAME DEFINED IN MANY FILES ===');
const fnDefs = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$\u4e00-\u9fff][\w$\u4e00-\u9fff]*)/gm)) {
    const n = m[1];
    if (!fnDefs.has(n)) fnDefs.set(n, []);
    fnDefs.get(n).push(rel(f));
  }
}
const dupFns = [...fnDefs.entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);
log(`function names defined in >1 file: ${dupFns.length}`);
for (const [n, v] of dupFns.slice(0, 40)) log(`  ${String(v.length).padStart(2)}x  ${n}   [${[...new Set(v)].slice(0, 5).join(', ')}]`);

// ---- duplicate literal providerOptions blocks ----
log('\n=== 2. DUPLICATED PROVIDER-OPTION / CONST BLOCKS ===');
const dupConstNames = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*[:=]/gm)) {
    const n = m[1];
    if (!dupConstNames.has(n)) dupConstNames.set(n, new Set());
    dupConstNames.get(n).add(rel(f));
  }
}
for (const [n, s] of [...dupConstNames.entries()].filter(([, s]) => s.size > 1).sort((a, b) => b[1].size - a[1].size).slice(0, 30)) {
  log(`  ${String(s.size).padStart(2)}x  ${n}   [${[...s].slice(0, 6).join(', ')}]`);
}

// ---- settings tabs size & shared-block census ----
log('\n=== 3. SETTINGS TABS ===');
const settingsDir = 'components/features/Settings';
for (const f of fs.readdirSync(settingsDir)) {
  const p = path.join(settingsDir, f);
  const n = fs.readFileSync(p, 'utf8').split('\n').length;
  log(`  ${String(n).padStart(5)}  ${f}`);
}
const MARKERS = ['smallClip', 'providerOptions', 'savedFlash', 'handleSave', 'saveMessage', 'clipPath'];
log('\n  marker occurrence across Settings tabs:');
for (const mk of MARKERS) {
  const hit = [];
  for (const f of fs.readdirSync(settingsDir)) {
    const src = fs.readFileSync(path.join(settingsDir, f), 'utf8');
    const c = (src.match(new RegExp(mk, 'g')) || []).length;
    if (c) hit.push(`${f}:${c}`);
  }
  log(`    ${mk.padEnd(16)} ${hit.length} files -> ${hit.slice(0, 8).join('  ')}`);
}

// ---- exact duplicated multi-line string constants ----
log('\n=== 4. EXACT DUPLICATED MULTILINE STRING LITERALS (clipPath polygons etc) ===');
const litMap = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/'([^'\n]{40,300})'/g)) {
    const v = m[1];
    if (!litMap.has(v)) litMap.set(v, new Set());
    litMap.get(v).add(rel(f));
  }
}
const duplit = [...litMap.entries()].filter(([, s]) => s.size > 1).sort((a, b) => b[1].size - a[1].size);
log(`distinct string literals (40-300 chars) repeated across files: ${duplit.length}`);
for (const [v, s] of duplit.slice(0, 20)) {
  log(`  ${s.size}x  "${v.slice(0, 90)}${v.length > 90 ? '...' : ''}"`);
  log(`        in: ${[...s].slice(0, 6).join(', ')}`);
}

// ---- cross-layer import violations: components importing services ----
log('\n=== 5. LAYER COUPLING: component files importing service modules ===');
const compFiles = files.filter((f) => rel(f).startsWith('components/'));
const deepImport = [];
for (const f of compFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const svc = [...src.matchAll(/from\s+['"]@\/services\/([^'"]+)['"]/g)].map((m) => m[1]);
  if (svc.length) deepImport.push({ file: rel(f), n: svc.length, svc: [...new Set(svc)] });
}
deepImport.sort((a, b) => b.n - a.n);
log(`component files importing @/services: ${deepImport.length} / ${compFiles.length}`);
for (const d of deepImport.slice(0, 20)) log(`  ${String(d.n).padStart(3)}  ${d.file}  -> ${d.svc.slice(0, 4).join(', ')}`);

// ---- App.tsx prop drilling census ----
log('\n=== 6. App.tsx SHAPE ===');
const app = fs.readFileSync('App.tsx', 'utf8');
log(`lines: ${app.split('\n').length}`);
log(`useState: ${(app.match(/useState/g) || []).length}`);
log(`useMemo: ${(app.match(/useMemo/g) || []).length}`);
log(`useCallback: ${(app.match(/useCallback/g) || []).length}`);
log(`useEffect: ${(app.match(/useEffect/g) || []).length}`);
log(`lazy imports: ${(app.match(/lazyWithRetry/g) || []).length}`);
log(`JSX props passed to <ChatList .../>:`);
const m = app.match(/<ChatList[\s\S]{0,900}?\/>/);
if (m) log(m[0].split('\n').map((l) => '    ' + l.trim()).join('\n'));

// ---- where the giant files actually spend lines ----
log('\n=== 7. BIG FILE INTERNAL SHAPE (function count & longest function) ===');
for (const target of ['hooks/useGame/sendWorkflow.ts', 'services/ai/chatCompletionClient.ts', 'services/dbService.ts', 'components/features/Settings/PromptModulesTab.tsx', 'components/features/Settings/StorageManager.tsx', 'utils/variableFacts.ts', 'App.tsx']) {
  const p = path.join(ROOT, target);
  if (!fs.existsSync(p)) continue;
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const fnStarts = [];
  lines.forEach((l, i) => {
    if (/^(?:export\s+)?(?:async\s+)?function\s+|^(?:export\s+)?const\s+\w+\s*=\s*(?:async\s*)?\(/.test(l)) fnStarts.push(i);
  });
  let longest = { name: '', len: 0 };
  fnStarts.forEach((s, k) => {
    const end = k + 1 < fnStarts.length ? fnStarts[k + 1] : lines.length;
    const len = end - s;
    if (len > longest.len) longest = { name: lines[s].trim().slice(0, 80), len };
  });
  log(`  ${target}`);
  log(`     lines=${lines.length}  topLevelFns=${fnStarts.length}  longestFn=${longest.len} lines  (${longest.name})`);
}

fs.writeFileSync('.audit/duplication.txt', out.join('\n'), 'utf8');
