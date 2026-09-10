import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
const dist = path.resolve('dist');
const rootDir = process.cwd();
function walk(dir) {
  let total = 0;
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      const sub = walk(p);
      total += sub.total;
      files.push(...sub.files);
    } else {
      total += stat.size;
      files.push({ name: path.relative(dist, p).replace(/\\/g, '/'), size: stat.size });
    }
  }
  return { total, files };
}
const { files } = walk(dist);
const js = files.filter((f) => f.name.endsWith('.js'));
const index = js.find((f) => f.name.startsWith('assets/index-'));
const maxChunk = js.reduce((a, b) => (b.size > a.size ? b : a), { name: '', size: 0 });
const totalJsBytes = js.reduce((sum, f) => sum + f.size, 0);
let gzipTotalBytes = 0;
for (const f of js) {
  try {
    gzipTotalBytes += zlib.gzipSync(fs.readFileSync(path.join(dist, f.name))).length;
  } catch {
    // 单个文件压缩失败不阻断报告
  }
}
const baseline = {
  indexBytes: index?.size ?? 0,
  maxChunkBytes: maxChunk.size,
  maxChunkName: maxChunk.name,
  totalJsBytes,
  gzipTotalBytes,
  top: [...js].sort((a, b) => b.size - a.size).slice(0, 12),
  at: new Date().toISOString(),
};
const baselinePath = path.join(rootDir, '.bundle-baseline.json');
if (process.argv.includes('--update') || !fs.existsSync(baselinePath)) {
  fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
  console.log('baseline written to .bundle-baseline.json');
} else {
  console.log('baseline unchanged (use --update to refresh): .bundle-baseline.json');
}
console.log(`index: ${((index?.size ?? 0) / 1024).toFixed(1)} KB`);
console.log(`max chunk: ${maxChunk.name} ${(maxChunk.size / 1024).toFixed(1)} KB`);
console.log(`total JS: ${(totalJsBytes / 1024).toFixed(1)} KB | gzip: ${(gzipTotalBytes / 1024).toFixed(1)} KB`);
