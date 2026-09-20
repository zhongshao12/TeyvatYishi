// 失败分诊器 v5（最终版）
// 修正 v4 的错误：不再用“像不像消息”的形状启发式过滤字面量（它吃掉了最关键的断言目标），
// 改为用“输出里真实出现的错误消息文本”做减法 —— 判据是位置，不是形状。
// 另修：支持打印式失败（无堆栈）、跨行 assert、readWorkflowSources 读取集合。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', '.output', 'coverage', '.vite', '.cache',
  'test-results', 'playwright-report', '.turbo', 'out', '.triage',
]);
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.json']);
const MAX_BYTES = 2 * 1024 * 1024;

function walk(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.tmp-')) continue;
      walk(full, acc);
    } else if (e.isFile()) {
      if (!EXTS.has(path.extname(e.name))) continue;
      let st; try { st = fs.statSync(full); } catch { continue; }
      if (st.size > MAX_BYTES) continue;
      acc.push(full);
    }
  }
  return acc;
}

const index = new Map();
for (const f of walk(root)) {
  try {
    let t = fs.readFileSync(f, 'utf8');
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    index.set(path.relative(root, f).split(path.sep).join('/'), t);
  } catch { /* ignore */ }
}

const homesCache = new Map();
function homesFor(lit) {
  if (homesCache.has(lit)) return homesCache.get(lit);
  const hits = [];
  for (const [rel, text] of index) if (text.includes(lit)) hits.push(rel);
  homesCache.set(lit, hits);
  return hits;
}

const relOf = (p) => path.relative(root, p).split(path.sep).join('/');
const readLines = (file) => { try { return fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { return []; } };

function allFrames(output) {
  const re = /at\s+(?:[^\s(]*\s+\()?(?:file:\/\/\/)?([A-Za-z]:[\\/][^\s:)]+\.mjs):(\d+):(\d+)/g;
  const out = []; let m;
  while ((m = re.exec(output))) {
    const file = m[1].replace(/\//g, path.sep);
    if (fs.existsSync(file)) out.push({ file, line: Number(m[2]), col: Number(m[3]) });
  }
  return out;
}

const HELPER_RE = /(if\s*\(\s*!condition\s*\)|if\s*\(\s*!ok\s*\)|throw new Error\(message\)|assert\.ok\(condition,\s*message\))/;

function stringLiterals(text) {
  const out = []; const re = /(['"`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g; let m;
  while ((m = re.exec(text))) { if (m[2]) out.push(m[2]); }
  return out;
}

function readSetOf(text) {
  const set = new Set();
  for (const v of stringLiterals(text)) {
    if (!v || v.length > 300) continue;
    if (!/[./]/.test(v)) continue;
    set.add(v);
  }
  return set;
}

function resolvePathLiteral(lit, scriptRel) {
  const cands = [];
  if (lit.startsWith('@/')) cands.push(lit.slice(2));
  else if (lit.startsWith('./') || lit.startsWith('../')) cands.push(path.posix.normalize(path.posix.join(path.posix.dirname(scriptRel), lit)));
  else cands.push(lit);
  const out = [];
  for (const c of cands) for (const rel of index.keys()) if (rel === c || rel.startsWith(`${c}/`)) out.push(rel);
  return out;
}

// 从一行出发，展开到括号平衡的完整语句
function expandStatement(arr, idx) {
  let text = arr[idx] ?? '';
  let bal = 0; let started = false;
  for (let i = idx; i < Math.min(arr.length, idx + 60); i += 1) {
    if (i > idx) text += `\n${arr[i]}`;
    for (const ch of arr[i]) { if (ch === '(') { bal += 1; started = true; } else if (ch === ')') bal -= 1; }
    if (started && bal <= 0) break;
    if (!started && /;\s*$/.test(arr[i])) break;
  }
  return text;
}

const names = process.argv.slice(2);
const report = [];

for (const name of names) {
  const scriptAbs = path.join(root, 'scripts', name);
  const scriptRel = `scripts/${name}`;
  const scriptLines = readLines(scriptAbs);
  const scriptText = scriptLines.join('\n');
  const r = spawnSync(process.execPath, [scriptAbs], { encoding: 'utf8', cwd: root, timeout: 180000 });
  const stdout = r.stdout || ''; const stderr = r.stderr || '';
  const output = `${stdout}\n${stderr}`;

  const entry = { name, exit: r.status, statements: [], readSet: [], note: null, tail: null, errText: null };

  // 1) 错误消息：优先 AssertionError/Error，否则取打印式失败行
  let errText = null;
  const m1 = /(?:AssertionError|Error)\s*(?:\[[^\]]*\])?\s*:\s*([^\n]+)/.exec(stderr);
  if (m1) errText = m1[1].trim();
  if (!errText) {
    const cand = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(✗|×|\u2717|\u00d7)/.test(l) || /失败|must|should/i.test(l));
    if (cand.length) errText = cand[cand.length - 1].replace(/^(✗|×|\u2717|\u00d7)\s*/, '');
  }
  entry.errText = errText;

  // 2) 定位失败语句
  const chosen = [];
  const frames = allFrames(output).filter((f) => relOf(f.file).startsWith('scripts/'));
  for (const f of frames) {
    if (relOf(f.file) !== scriptRel) continue;
    const lt = (readLines(f.file)[f.line - 1] || '');
    if (HELPER_RE.test(lt)) continue;
    chosen.push({ file: f.file, line: f.line, col: f.col });
    break;
  }
  // 打印式失败：用错误消息在脚本里反查检查点
  if (!chosen.length && errText) {
    const needle = errText.slice(0, 30);
    for (let i = 0; i < scriptLines.length; i += 1) {
      if (scriptLines[i].includes(needle)) { chosen.push({ file: scriptAbs, line: i + 1, col: 1 }); break; }
    }
  }
  if (!chosen.length && frames.length) chosen.push({ file: frames[0].file, line: frames[0].line, col: frames[0].col });

  // 3) 读取集合（含 workflowSources 展开）
  const rsResolved = new Set();
  for (const lit of readSetOf(scriptText)) for (const rr of resolvePathLiteral(lit, scriptRel)) rsResolved.add(rr);
  if (/workflowSources/.test(scriptText)) {
    const libText = index.get('scripts/lib/workflowSources.mjs') || '';
    for (const lit of stringLiterals(libText)) {
      if (!/\.(ts|tsx)$/.test(lit)) continue;
      for (const rr of resolvePathLiteral(lit, scriptRel)) rsResolved.add(rr);
    }
  }
  entry.readSet = Array.from(rsResolved).sort();

  for (const c of chosen) {
    const arr = readLines(c.file);
    const stmt = expandStatement(arr, c.line - 1);
    const literals = Array.from(new Set(stringLiterals(stmt)))
      .filter((l) => l.length > 0 && l.length <= 200)
      .filter((l) => !(errText && errText.includes(l)))          // 用真实错误消息做减法
      .filter((l) => !/^(assert|throw|Error|message|condition)$/.test(l));
    const items = literals.map((lit) => {
      const homes = homesFor(lit).filter((h) => !h.startsWith('scripts/') || h.startsWith('scripts/lib/') === false);
      const prod = homesFor(lit).filter((h) => !h.startsWith('scripts/') && !h.startsWith('.audit/') && !h.startsWith('tests/'));
      return {
        lit,
        total: homesFor(lit).length,
        prod,
        missing: prod.filter((h) => !rsResolved.has(h)),
      };
    });
    entry.statements.push({
      at: `${relOf(c.file)}:${c.line}:${c.col}`,
      stmt: stmt.slice(0, 600),
      items,
    });
  }

  const mm = /Cannot find module '([^']+)'/.exec(stderr);
  const mp = /Cannot find package '([^']+)'/.exec(stderr);
  if (mm) entry.note = `MODULE_NOT_FOUND: ${mm[1]}`;
  else if (mp) entry.note = `PACKAGE_NOT_FOUND: ${mp[1]}`;
  if (!chosen.length) entry.tail = `${stdout}\n${stderr}`.trim().split(/\r?\n/).slice(-12).join('\n');

  report.push(entry);
  process.stderr.write(`[v5] ${name}\n`);
}

const outDir = path.join(root, '.triage');
fs.mkdirSync(outDir, { recursive: true });
const md = ['# 失败分诊 v5\n', `索引: ${index.size} 文件\n`];
for (const e of report) {
  md.push(`## ${e.name} (exit ${e.exit})`);
  if (e.note) md.push(`- 备注: ${e.note}`);
  if (e.errText) md.push(`- 错误消息: ${e.errText.slice(0, 200)}`);
  for (const s of e.statements) {
    md.push(`- 失败语句 @ \`${s.at}\`:`);
    md.push('  ```js\n  ' + s.stmt.replace(/\n/g, '\n  ') + '\n  ```');
    for (const it of s.items) {
      if (it.prod.length === 0) md.push(`  - \`${it.lit}\` -> **生产代码中未找到**（全仓 ${it.total} 处）`);
      else if (it.missing.length === 0) md.push(`  - \`${it.lit}\` -> 读取集合已覆盖：${it.prod.join(', ')}`);
      else md.push(`  - \`${it.lit}\` -> **需新增读取**: ${it.missing.slice(0, 6).join(', ')}${it.prod.length > it.missing.length ? ` | 已覆盖: ${it.prod.filter((h) => !it.missing.includes(h)).join(', ')}` : ''}`);
    }
  }
  if (e.readSet.length) md.push(`- 读取集合(${e.readSet.length}): ${e.readSet.map((x) => `\`${x}\``).join(', ')}`);
  if (e.tail) md.push('```\n' + e.tail + '\n```');
  md.push('');
}
const outFile = process.env.TRIAGE_OUT || 'v5-report.md';
fs.writeFileSync(path.join(outDir, outFile), md.join('\n'), 'utf8');
console.log(`wrote .triage/${outFile} (${report.length} scripts)`);
