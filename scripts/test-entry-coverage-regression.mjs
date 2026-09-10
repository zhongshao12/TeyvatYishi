import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const manifest = await import('./lib/regressionManifest.mjs');
const extra = new Set(manifest.EXTRA_REGRESSION_SCRIPTS);
const scanned = new Set(fs.readdirSync('scripts').filter((f) => f.endsWith('-regression.mjs')));
const excluded = new Set(['run-all-regressions.mjs', 'run-prompt-regressions.mjs']);
const missing = [];
for (const [name, value] of Object.entries(pkg.scripts)) {
  if (!name.startsWith('test:') && !name.startsWith('validate:')) continue;
  const match = String(value).match(/node scripts\/([\w.-]+\.mjs)/);
  if (!match) continue;
  const file = match[1];
  if (scanned.has(file) || extra.has(file) || excluded.has(file)) continue;
  missing.push(`${name} -> ${file}`);
}
assert(missing.length === 0, '未被全量回归聚合的测试入口: ' + missing.join(', '));
console.log('test entry coverage regression ok');
