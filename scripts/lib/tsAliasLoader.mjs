// Node ESM resolve 钩子：把 `@/x/y` 解析到仓库根的 x/y.ts。
// 回归脚本里有直接 import 生产 .ts 的行为测试（不经 vite 别名），此前必然失败。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.env.REGRESSION_ROOT || process.cwd();

function resolveAlias(specifier) {
  if (!specifier.startsWith('@/')) return null;
  const base = path.join(root, specifier.slice(2));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  const hit = resolveAlias(specifier);
  if (hit) return { url: pathToFileURL(hit).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
