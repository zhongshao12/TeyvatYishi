import fs from 'node:fs';
function assert(condition, message) { if (!condition) throw new Error(message); }
const app = fs.readFileSync('App.tsx', 'utf8');
const lazy = fs.readFileSync('utils/lazyWithRetry.ts', 'utf8');
assert(lazy.includes('preloadAll'), 'lazyWithRetry must expose preloadAll.');
assert(app.includes('preloadAll('), 'App must idle-preload game panels.');
for (const panel of ['PlotPanel', 'IrminsulPanel', 'AlbumPanel']) {
  assert(app.includes(panel), 'App must keep ' + panel + ' lazy-loaded but preloadable.');
}
assert(!app.includes("from '@/components/features/GameSystems/PlotPanel'"), 'App must not statically import heavy panels.');
