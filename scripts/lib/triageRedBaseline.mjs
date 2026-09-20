/**
 * 一次性分诊工具 v2（不进仓库门禁）。
 *
 * 对每个失败的回归脚本：
 *   1. 提取它读取的文件（readFileSync / read(...)）；
 *   2. 提取它所有 assert 中 includes()/indexOf()/startsWith() 的「实参字面量」
 *      —— 只取实参，不取 assert 的第二个参数（消息文案）；
 *   3. 判断该字面量在「读取集合」里是否已不存在（正断言=问题；负断言=正常）；
 *   4. 全仓定位它现在住在哪个文件。
 *
 * 用法：node triage.mjs <失败脚本名...> [--json]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'coverage', '.tmp', '.audit', '.superpowers',
  '.trae', '.reasonix', 'storybook-static', '.workbuddy', 'backups',
]);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.tmp-')) continue;
      walk(path.join(dir, entry.name), out);
    } else if (/\.(ts|tsx|mjs|js|json|md)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const ALL_REL = walk(ROOT).map((abs) => path.relative(ROOT, abs).replace(/\\/g, '/'));

const contentCache = new Map();
function contentOf(rel) {
  if (!contentCache.has(rel)) {
    const abs = path.join(ROOT, rel);
    contentCache.set(rel, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null);
  }
  return contentCache.get(rel);
}

function findHomes(needle, exclude) {
  const homes = [];
  for (const rel of ALL_REL) {
    if (rel === exclude) continue;
    const text = contentOf(rel);
    if (text && text.includes(needle)) homes.push(rel);
  }
  return homes;
}

function readTargets(source) {
  const targets = new Set();
  let m;
  const re = /readFileSync\(\s*['"`]([^'"`]+)['"`]/g;
  while ((m = re.exec(source))) targets.add(m[1].replace(/\\/g, '/'));
  const re2 = /(?:^|[^.\w])(?:read|readFile)\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  while ((m = re2.exec(source))) {
    const t = m[1].replace(/\\/g, '/');
    if (!t.startsWith('node:') && !t.startsWith('http')) targets.add(t);
  }
  return [...targets];
}

/** 只提取 assert 行内 includes/indexOf/startsWith/endsWith 的实参字面量，并标注正负。 */
function assertedLiterals(source) {
  const found = new Map();
  // 只在断言行内提取：避免把普通业务代码里的 .includes( 当成断言目标
  const assertOnly = source
    .split('\n')
    .filter((line) => /(?:assert|throw new Error|_assert)/.test(line))
    .join('\n');
  const re = /(!?)\s*[\w.?\[\]'"()]*\.(includes|indexOf|startsWith|endsWith)\(\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/g;
  let m;
  while ((m = re.exec(assertOnly))) {
    const literal = m[4];
    if (literal.length < 6) continue;
    if (!/[A-Za-z_\u4e00-\u9fa5]/.test(literal)) continue;
    // 反斜杠转义还原不了就不处理（避免假匹配）
    if (/\\/.test(literal)) continue;
    const negative = m[1] === '!';
    if (!found.has(literal)) found.set(literal, { literal, negative });
  }
  // match(/regex/)：取其中最长的不含元字符的片段
  const re2 = /\.match\(\s*\/((?:\\.|[^/\\])+)\/[a-z]*\s*\)/g;
  while ((m = re2.exec(assertOnly))) {
    const runs = m[1].split(/[\\\[\](){}*+?|^$.]+/).filter((s) => s.length >= 8);
    for (const run of runs) {
      if (!found.has(run)) found.set(run, { literal: run, negative: /\blet\s+\w+\s*=\s*/.test(''), fromRegex: true });
    }
  }
  return [...found.values()];
}

const args = process.argv.slice(2);
const failing = args.filter((a) => a.endsWith('.mjs'));
if (failing.length === 0) {
  console.error('用法: node triage.mjs <失败脚本名...> [--json]');
  process.exit(2);
}

const report = [];
for (const name of failing) {
  const rel = `scripts/${name}`;
  const source = contentOf(rel);
  if (source == null) {
    report.push({ script: name, error: '脚本不存在' });
    continue;
  }
  const targets = readTargets(source);
  const combined = targets.map((t) => contentOf(t)).filter(Boolean).join('\n');
  const problems = [];
  for (const item of assertedLiterals(source)) {
    const present = combined.includes(item.literal);
    if (item.negative) {
      // 负断言：字面量不存在才是对的
      if (present) problems.push({ ...item, issue: '负断言失败：字面量仍存在于读取集合' });
      continue;
    }
    if (present) continue;
    const homes = findHomes(item.literal, rel);
    problems.push({ ...item, issue: '正断言缺失', homes: homes.slice(0, 5) });
  }
  report.push({ script: name, readTargets: targets, problems });
}

for (const entry of report) {
  if (entry.error) {
    console.log(`\n### ${entry.script}\n  ⚠ ${entry.error}`);
    continue;
  }
  console.log(`\n### ${entry.script}`);
  if (entry.problems.length === 0) {
    console.log('  ✅ 未发现 missing/negative 问题（失败可能来自正则、indexOf 顺序或子脚本）');
    continue;
  }
  for (const p of entry.problems) {
    if (p.issue.startsWith('负断言')) {
      console.log(`  ✗ [负断言] "${p.literal}"`);
      continue;
    }
    const homes = p.homes && p.homes.length
      ? `→ ${p.homes.join(' | ')}`
      : '→ 全仓未找到（已删除或改名）';
    console.log(`  ✗ "${p.literal}"\n      ${homes}`);
  }
}

if (args.includes('--json')) {
  fs.writeFileSync(path.join(ROOT, '.triage-report.json'), JSON.stringify(report, null, 2));
  console.log('\n[已写出 .triage-report.json]');
}
