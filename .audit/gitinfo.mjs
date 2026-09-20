import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const out = [];
const run = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    return `[git failed: ${e.message}]`;
  }
};

const files = run(['ls-files']).split('\n').filter(Boolean);
out.push(`tracked files: ${files.length}`);

const suspects = ['tsbuildinfo', '.tmp', 'docs/', 'assets-src', 'superpowers', 'reasonix', '.trae/', 'workbuddy', 'bundle-baseline', 'stories/assets', '.pnpm-store', 'bun.lock'];
out.push('\n=== tracked files matching suspicious patterns ===');
for (const s of suspects) {
  const hit = files.filter((f) => f.includes(s));
  if (hit.length) out.push(`  [${s}] -> ${hit.length}:\n    ` + hit.slice(0, 12).join('\n    '));
}

out.push('\n=== tracked file count by top dir ===');
const byDir = new Map();
for (const f of files) {
  const top = f.includes('/') ? f.split('/')[0] : '(root)';
  byDir.set(top, (byDir.get(top) || 0) + 1);
}
for (const [k, v] of [...byDir.entries()].sort((a, b) => b[1] - a[1])) out.push(`  ${String(v).padStart(5)}  ${k}`);

out.push('\n=== tracked binary/asset files > 100KB ===');
const big = [];
for (const f of files) {
  try {
    const st = fs.statSync(f);
    if (st.size > 100 * 1024) big.push([st.size, f]);
  } catch { /* deleted */ }
}
big.sort((a, b) => b[0] - a[0]);
for (const [s, f] of big.slice(0, 30)) out.push(`  ${(s / 1024).toFixed(0).padStart(7)} KB  ${f}`);

out.push('\n=== git log summary ===');
out.push(run(['log', '--oneline', '-8']));
out.push('\n=== working tree status ===');
out.push(run(['status', '--short']).slice(0, 3000) || '(clean)');

out.push('\n=== is docs/ ignored but tracked? ===');
out.push(run(['check-ignore', '-v', 'docs/', 'tsconfig.tsbuildinfo', '.tmp-regression', 'stories/assets/addon-library.png', '.superpowers']));

fs.writeFileSync('.audit/git.txt', out.join('\n'), 'utf8');
