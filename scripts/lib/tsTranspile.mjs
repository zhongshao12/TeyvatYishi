// 共享 TS 转译修正器 + 本地依赖闭包计算。
// 目的：消灭各 .tmp-* 回归脚本里“硬编码别名目录清单 + 手工转译文件清单”这一类反复出现的缺陷。
import fs from 'node:fs';
import path from 'node:path';

const IMPORT_RE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

/**
 * 通用地把 `@/x/y` 改写成相对 sourceDir 的路径，并给裸相对导入补 .mjs 后缀。
 * 与旧实现的区别：不再列举别名下的目录（data|models|services|...），任何 @/ 前缀都处理。
 */
export function rewriteModuleSpecifiers(code, sourceDir) {
  return code
    .replace(/(['"])@\/([^'"]+)\1/g, (_m, quote, spec) => {
      const dir = path.posix.dirname(spec);
      const base = path.posix.basename(spec);
      let rel = path.posix.relative(sourceDir, dir === '.' ? '' : dir);
      if (rel === '') rel = '.';
      else if (!rel.startsWith('.')) rel = `./${rel}`;
      return `${quote}${rel}/${base}${quote}`;
    })
    .replace(/from\s+(['"])((?:\.\/|\.\.\/)[^'"]+)\1/g, (match, quote, specifier) => {
      if (/\.(mjs|cjs|js|json)$/.test(specifier)) return match;
      return `from ${quote}${specifier}.mjs${quote}`;
    });
}

function resolveLocal(rootDir, fromRel, spec) {
  const cands = [];
  if (spec.startsWith('@/')) cands.push(spec.slice(2));
  else if (spec.startsWith('.')) cands.push(path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec)));
  else return null; // 裸包名，交给运行时
  for (const c of cands) {
    for (const ext of ['.ts', '.tsx', '']) {
      const rel = `${c}${ext}`;
      if (fs.existsSync(path.join(rootDir, rel)) && fs.statSync(path.join(rootDir, rel)).isFile()) return rel;
    }
    for (const ext of ['.ts', '.tsx']) {
      const rel = path.posix.join(c, `index${ext}`);
      if (fs.existsSync(path.join(rootDir, rel))) return rel;
    }
  }
  return null;
}

/** 计算入口文件的本地 import 闭包（不含入口自身）。 */
export function localImportClosure(rootDir, entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    let text;
    try { text = fs.readFileSync(path.join(rootDir, rel), 'utf8'); } catch { continue; }
    const re = new RegExp(IMPORT_RE.source, 'g');
    let m;
    while ((m = re.exec(text))) {
      const target = resolveLocal(rootDir, rel, m[1]);
      if (target && !seen.has(target) && !entries.includes(target)) queue.push(target);
    }
    seen.add(rel);
  }
  return Array.from(seen).filter((x) => !entries.includes(x)).sort();
}

if (process.argv[2] === 'closure') {
  const rootDir = process.cwd();
  const entries = process.argv.slice(3);
  const missing = localImportClosure(rootDir, entries);
  console.log(`入口 ${entries.length} 个；本地依赖闭包额外 ${missing.length} 个：`);
  for (const m of missing) console.log(`  ${m}`);
}
