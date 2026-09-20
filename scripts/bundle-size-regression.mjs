import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
function assert(condition, message) { if (!condition) throw new Error(message); }
const dist = path.resolve('dist');
const budgetPath = path.resolve('.bundle-budget.json');
assert(fs.existsSync(budgetPath), 'missing .bundle-budget.json; bundle limits must be reviewed and committed explicitly.');
assert(fs.existsSync(dist), '缺少 dist 目录；请先运行构建（pnpm build），再执行体积门禁。');
assert(fs.existsSync(path.join(dist, 'assets')), '缺少 dist/assets 目录；请先运行构建（pnpm build），再执行体积门禁。');
const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
const assets = fs.readdirSync(path.join(dist, 'assets')).filter((f) => f.endsWith('.js'));
const indexName = assets.find((f) => f.startsWith('index-'));
assert(indexName, 'missing main index chunk in dist/assets.');
const indexBytes = fs.statSync(path.join(dist, 'assets', indexName)).size;
let maxChunkBytes = 0;
let maxChunkName = '';
let totalJsBytes = 0;
let gzipTotalBytes = 0;
for (const name of assets) {
  const file = path.join(dist, 'assets', name);
  const size = fs.statSync(file).size;
  totalJsBytes += size;
  if (size > maxChunkBytes) {
    maxChunkBytes = size;
    maxChunkName = name;
  }
  try {
    gzipTotalBytes += zlib.gzipSync(fs.readFileSync(file)).length;
  } catch {
    // 忽略压缩失败的文件
  }
}
const capIndex = Number(budget.indexBytes);
const capMaxChunk = Number(budget.maxChunkBytes);
const capTotalJs = Number(budget.totalJsBytes);
const capGzipTotal = Number(budget.gzipTotalBytes);
assert([capIndex, capMaxChunk, capTotalJs, capGzipTotal].every((value) => Number.isFinite(value) && value > 0), 'bundle budget contains invalid byte limits.');
assert(indexBytes < capIndex, `主 index chunk ${(indexBytes / 1024).toFixed(1)} KB 超过硬上限 ${(capIndex / 1024).toFixed(1)} KB。`);
assert(maxChunkBytes < capMaxChunk, `最大单块 ${maxChunkName} ${(maxChunkBytes / 1024).toFixed(1)} KB 超过预算 ${(capMaxChunk / 1024).toFixed(1)} KB。`);
assert(totalJsBytes < capTotalJs, `总 JS ${(totalJsBytes / 1024).toFixed(1)} KB 超过预算 ${(capTotalJs / 1024).toFixed(1)} KB。`);
assert(gzipTotalBytes < capGzipTotal, `总 JS gzip ${(gzipTotalBytes / 1024).toFixed(1)} KB 超过预算 ${(capGzipTotal / 1024).toFixed(1)} KB。`);
console.log(`OK: index ${(indexBytes / 1024).toFixed(1)} KB ≤ ${(capIndex / 1024).toFixed(1)} KB; max ${maxChunkName} ${(maxChunkBytes / 1024).toFixed(1)} KB ≤ ${(capMaxChunk / 1024).toFixed(1)} KB; total JS ${(totalJsBytes / 1024).toFixed(1)} KB ≤ ${(capTotalJs / 1024).toFixed(1)} KB; gzip ${(gzipTotalBytes / 1024).toFixed(1)} KB ≤ ${(capGzipTotal / 1024).toFixed(1)} KB`);
