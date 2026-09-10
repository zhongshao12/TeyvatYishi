import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
function assert(condition, message) { if (!condition) throw new Error(message); }
const dist = path.resolve('dist');
const baselinePath = path.resolve('.bundle-baseline.json');
assert(fs.existsSync(baselinePath), 'missing .bundle-baseline.json; run pnpm build && node scripts/bundle-size-report.mjs --update first.');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
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
const capIndex = 300 * 1024;
const capMaxChunk = Math.min(Math.floor(baseline.maxChunkBytes * 1.15), 3.5 * 1024 * 1024);
const capTotalJs = Math.floor(baseline.totalJsBytes * 1.15);
assert(indexBytes < capIndex, `主 index chunk ${(indexBytes / 1024).toFixed(1)} KB 超过硬上限 ${(capIndex / 1024).toFixed(1)} KB。`);
assert(maxChunkBytes < capMaxChunk, `最大单块 ${maxChunkName} ${(maxChunkBytes / 1024).toFixed(1)} KB 超过预算 ${(capMaxChunk / 1024).toFixed(1)} KB。`);
assert(totalJsBytes < capTotalJs, `总 JS ${(totalJsBytes / 1024).toFixed(1)} KB 超过基线 115% ${(capTotalJs / 1024).toFixed(1)} KB。`);
console.log(`OK: index ${(indexBytes / 1024).toFixed(1)} KB ≤ ${(capIndex / 1024).toFixed(1)} KB; max ${maxChunkName} ${(maxChunkBytes / 1024).toFixed(1)} KB ≤ ${(capMaxChunk / 1024).toFixed(1)} KB; total JS ${(totalJsBytes / 1024).toFixed(1)} KB ≤ ${(capTotalJs / 1024).toFixed(1)} KB; gzip ${(gzipTotalBytes / 1024).toFixed(1)} KB`);
