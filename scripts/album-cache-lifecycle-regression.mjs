import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const cache = await readFile(new URL('../utils/albumObjectUrl.ts', import.meta.url), 'utf8');
const saveLoad = await readFile(new URL('../hooks/useGame/saveLoadWorkflow.ts', import.meta.url), 'utf8');

assert.match(cache, /export function pruneAlbumAssetCache/);
assert.match(cache, /if \(!retained\.has\(id\)\) revokeAlbumAsset\(id\)/);
assert.match(cache, /totalBytes \+= entry\.blob\.size/);
assert.match(saveLoad, /const nextAlbum = materializeAlbumRuntimePayload\(nextGame\.相册\)/);
assert.match(saveLoad, /pruneAlbumAssetCache\(nextAlbum\.assets\.map\(\(asset\) => asset\.id\)\)/);
assert.ok(
  saveLoad.indexOf('pruneAlbumAssetCache(nextAlbum.assets.map((asset) => asset.id))')
    > saveLoad.indexOf('const nextAlbum = materializeAlbumRuntimePayload(nextGame.相册)'),
  'cache pruning must use the materialized formal Teyvat album',
);

console.log('album cache lifecycle regression ok');
