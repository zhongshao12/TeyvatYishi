import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const albumUrl = fs.readFileSync('utils/albumObjectUrl.ts', 'utf8');
const workspaces = fs.readFileSync('components/features/GameSystems/album/workspaces.tsx', 'utf8');
assert(albumUrl.includes('MAX_ALBUM_CACHE_BYTES'), 'album cache must have a byte cap.');
assert(albumUrl.includes('enforceAlbumCacheLimit'), 'album cache must enforce the cap.');
assert(workspaces.includes('loading="lazy"'), 'album images must lazy load.');
console.log('album lazy load regression ok');
