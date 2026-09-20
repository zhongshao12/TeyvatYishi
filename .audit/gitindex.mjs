import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const ROOT = process.cwd();
const out = [];

// Parse .git/index (version 2/3/4) without git binary.
const gitDir = path.join(ROOT, '.git');
out.push('=== .git contents ===');
out.push(fs.readdirSync(gitDir).join(', '));

const idxPath = path.join(gitDir, 'index');
if (!fs.existsSync(idxPath)) {
  out.push('no .git/index');
} else {
  const buf = fs.readFileSync(idxPath);
  const sig = buf.toString('ascii', 0, 4);
  const ver = buf.readUInt32BE(4);
  const count = buf.readUInt32BE(8);
  out.push(`index signature=${sig} version=${ver} entries=${count}`);

  let off = 12;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const start = off;
    // 62-byte fixed header (v2/3), then name NUL-padded to multiple of 8
    const flags = buf.readUInt16BE(off + 60);
    const nameLen = flags & 0x0fff;
    const nameStart = off + 62;
    let name;
    if (ver >= 4) {
      // v4: prefix-compressed; bail out
      name = null;
    } else {
      name = buf.toString('utf8', nameStart, nameStart + nameLen);
    }
    if (name === null) break;
    const entryLen = 62 + nameLen;
    const padded = Math.ceil((entryLen + 1) / 8) * 8;
    off = start + padded;
    entries.push(name);
  }
  out.push(`parsed ${entries.length} entries`);

  const byDir = new Map();
  for (const f of entries) {
    const top = f.includes('/') ? f.split('/')[0] : '(root)';
    byDir.set(top, (byDir.get(top) || 0) + 1);
  }
  out.push('\n=== tracked count by top dir ===');
  for (const [k, v] of [...byDir.entries()].sort((a, b) => b[1] - a[1])) out.push(`  ${String(v).padStart(6)}  ${k}`);

  const suspects = ['tsbuildinfo', '.tmp-regression', 'docs/', 'assets-src', 'superpowers', 'reasonix', '.trae/', 'workbuddy', 'bundle-baseline', 'stories/assets', '.pnpm-store'];
  out.push('\n=== tracked files matching suspicious patterns ===');
  for (const s of suspects) {
    const hit = entries.filter((f) => f.includes(s));
    out.push(`  [${s}] -> ${hit.length}${hit.length ? ':\n    ' + hit.slice(0, 15).join('\n    ') : ''}`);
  }

  out.push('\n=== tracked files > 100KB ===');
  const big = [];
  for (const f of entries) {
    const p = path.join(ROOT, f);
    try { const st = fs.statSync(p); if (st.size > 100 * 1024) big.push([st.size, f]); } catch { /* missing */ }
  }
  big.sort((a, b) => b[0] - a[0]);
  for (const [s, f] of big.slice(0, 40)) out.push(`  ${(s / 1024).toFixed(0).padStart(7)} KB  ${f}`);
  out.push(`  total >100KB tracked: ${big.length}`);
}

fs.writeFileSync(path.join(ROOT, '.audit', 'git.txt'), out.join('\n'), 'utf8');
