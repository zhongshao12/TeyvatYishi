import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kty-bundle-budget-'));
try {
  const assetsDir = path.join(fixtureRoot, 'dist', 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.writeFileSync(path.join(assetsDir, 'index-fixture.js'), Buffer.alloc(1024));
  fs.writeFileSync(path.join(assetsDir, 'chunk-too-large.js'), Buffer.alloc(1_600 * 1024));
  fs.writeFileSync(path.join(fixtureRoot, '.bundle-baseline.json'), JSON.stringify({
    maxChunkBytes: 100 * 1024 * 1024,
    totalJsBytes: 100 * 1024 * 1024,
  }));
  fs.writeFileSync(path.join(fixtureRoot, '.bundle-budget.json'), JSON.stringify({
    indexBytes: 300 * 1024,
    maxChunkBytes: 1536 * 1024,
    totalJsBytes: 3 * 1024 * 1024,
    gzipTotalBytes: 1024 * 1024,
  }));

  const scriptPath = path.resolve('scripts/bundle-size-regression.mjs');
  const result = spawnSync(process.execPath, [scriptPath], { cwd: fixtureRoot, encoding: 'utf8' });
  assert(result.status !== 0, '固定体积预算必须拒绝 1600KB 单块，即使历史 baseline 被调得很大。');
  assert(`${result.stdout}\n${result.stderr}`.includes('超过预算'), '体积门禁失败时必须指出超预算。');

  const missingDistRoot = path.join(fixtureRoot, 'missing-dist');
  fs.mkdirSync(missingDistRoot, { recursive: true });
  fs.writeFileSync(
    path.join(missingDistRoot, '.bundle-budget.json'),
    fs.readFileSync(path.join(fixtureRoot, '.bundle-budget.json')),
  );
  const missingDistResult = spawnSync(process.execPath, [scriptPath], {
    cwd: missingDistRoot,
    encoding: 'utf8',
  });
  assert(missingDistResult.status !== 0, '缺少 dist 时体积门禁必须失败。');
  assert(
    `${missingDistResult.stdout}\n${missingDistResult.stderr}`.includes('请先运行构建'),
    '缺少 dist 时必须给出可执行的构建提示，而不是暴露 ENOENT。',
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('bundle size budget regression ok');
