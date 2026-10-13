import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
function assert(condition, message) { if (!condition) throw new Error(message); }
const app = fs.readFileSync('App.tsx', 'utf8');
const lazy = fs.readFileSync('utils/lazyWithRetry.ts', 'utf8');
assert(lazy.includes('preloadAll'), 'lazyWithRetry must expose preloadAll.');
assert(app.includes('useGamePanelPreload(state.turnCount, GAME_PANELS_TO_PRELOAD)'), 'App must connect game turns to idle panel warming.');
for (const panel of ['PlotPanel', 'IrminsulPanel', 'AlbumPanel']) {
  assert(app.includes(panel), 'App must keep ' + panel + ' lazy-loaded but preloadable.');
}
assert(!app.includes("from '@/components/features/GameSystems/PlotPanel'"), 'App must not statically import heavy panels.');
// The lifecycle lives in a dedicated hook now. Exercise its real React behavior,
// rather than requiring preloadAll to remain physically inside App.tsx.
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run',
  'tests/unit/gamePanelPreloadLifecycle.test.tsx', 'tests/unit/idlePanelPreload.test.ts', '--reporter=dot'],
{ encoding: 'utf8', timeout: 60000 });
assert(!result.error && result.status === 0, `Idle preload behavior failed: ${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
console.log('Idle panel preload lifecycle regression passed.');
