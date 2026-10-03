import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { registerLiveGameSessionAlias } from '@/hooks/useTeyvatRuntime';
const delay = vi.hoisted(() => ({ wait: null as Promise<void> | null }));
vi.mock('@/services/storage/gameDatabase', async original => {
  const actual = await original<typeof import('@/services/storage/gameDatabase')>();
  return { ...actual, openGameDatabase: async () => { const wait = delay.wait; delay.wait = null; if (wait) await wait; return actual.openGameDatabase(); } };
});
import { saveSetting, loadSetting } from '@/services/storage/indexedSettingsStore';
afterEach(() => { registerLiveGameSessionAlias(null); });
it('isolates actual persistent writes when old-session storage completes after the new session', async () => {
  let session = 51; registerLiveGameSessionAlias(() => session);
  let release!: () => void; delay.wait = new Promise<void>(resolve => { release = resolve; });
  const oldWrite = saveSetting('storyWeavingSystem', { playerEdit: 'A' });
  session = 52; await saveSetting('storyWeavingSystem', { playerEdit: 'B' });
  release(); await oldWrite;
  expect(await loadSetting('storyWeavingSystem')).toEqual({ playerEdit: 'B' });
  session = 51; expect(await loadSetting('storyWeavingSystem')).toEqual({ playerEdit: 'A' });
});
