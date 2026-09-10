import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const manifestPath = path.resolve('public/assets/teyvat-avatars/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const assets = Array.isArray(manifest.assets) ? manifest.assets : [];

assert.equal(manifest.roster?.expected, 120, 'avatar manifest must keep the 120-character roster contract');
assert.equal(assets.length, 120, 'avatar manifest must contain one entry for every roster character');
assert.equal(new Set(assets.map((asset) => asset.id)).size, assets.length, 'avatar manifest ids must be unique');

for (const asset of assets) {
  assert.equal(typeof asset.path, 'string', `avatar ${asset.id} must have a public path`);
  const absolutePath = path.resolve('public', decodeURIComponent(asset.path.replace(/^\/assets\//u, 'assets/')));
  assert.ok(fs.existsSync(absolutePath), `avatar manifest path must exist: ${asset.path}`);
}

console.log('Teyvat avatar manifest regression passed: 120/120 public paths exist.');
