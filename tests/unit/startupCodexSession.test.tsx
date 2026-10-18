// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameState, type UseGameStateReturn } from '@/hooks/useGameState';
import { registerLiveGameSessionAlias } from '@/hooks/useTeyvatRuntime';
import { createEmptyTeyvatGameState, normalizeArchiveCodex } from '@/models/teyvat';
import { 创建图鉴条目, type 图鉴系统 } from '@/models/codex';
import { LEGACY_CODEX_SETTING_KEY } from '@/compat/legacy-hsr/readOnly';

const io = vi.hoisted(() => ({ store: new Map<string, unknown>(), loadCodex: vi.fn(), hasAnySave: vi.fn() }));
vi.mock('@/services/dbService', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/dbService')>(),
  loadSetting: async (key: string) => io.store.get(key) ?? null,
  saveSetting: async (key: string, value: unknown) => { io.store.set(key, value); },
  hasAnySave: () => io.hasAnySave(),
}));
vi.mock('@/services/workflowRecovery', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/workflowRecovery')>(),
  loadWorkflowRecoveryJournal: async () => null,
}));
vi.mock('@/data/storyWeavingPreset', async importOriginal => {
  const original = await importOriginal<typeof import('@/data/storyWeavingPreset')>();
  const { 创建空剧情编织系统 } = await import('@/models/storyWeaving');
  return { ...original, loadAllBundledStoryWeavingPresets: async () => 创建空剧情编织系统() };
});
vi.mock('@/data/codexPreset', async importOriginal => ({
  ...await importOriginal<typeof import('@/data/codexPreset')>(),
  loadAllBundledCodexPresets: () => io.loadCodex(),
}));
vi.mock('@/data/openingWorldbookPreset', async importOriginal => ({
  ...await importOriginal<typeof import('@/data/openingWorldbookPreset')>(),
  loadAllBundledWorldbookPresets: async () => [],
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const preset: 图鉴系统 = { 条目: [{ ...创建图鉴条目({ 标题: '启动资料', 分类: 'term', 原文: '来自启动资源' }), id: 'startup-entry', builtin: true }] };

describe('startup codex live-session ownership (A02)', () => {
  let root: Root;
  let host: HTMLDivElement;
  let state: UseGameStateReturn;
  beforeEach(() => {
    io.store.clear();
    io.loadCodex.mockReset();
    io.hasAnySave.mockReset().mockResolvedValue(false);
    io.store.set(LEGACY_CODEX_SETTING_KEY, preset);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    registerLiveGameSessionAlias(null);
    vi.restoreAllMocks();
  });
  function Harness() { state = useGameState(); return null; }
  async function mountPending() {
    const loading = deferred<图鉴系统>();
    io.loadCodex.mockReturnValue(loading.promise);
    await act(async () => root.render(createElement(Harness)));
    await vi.waitFor(() => expect(io.loadCodex).toHaveBeenCalledOnce());
    return loading;
  }
  async function finish(loading: ReturnType<typeof deferred<图鉴系统>>, path: string) {
    await act(async () => {
      if (path === 'normal') loading.resolve(preset);
      else loading.reject(new Error('fixture unavailable bundled preset'));
      await vi.waitFor(() => expect(io.hasAnySave).toHaveBeenCalledOnce());
    });
  }

  it.each(['normal', 'fallback'])('keeps save-only entries and unlocks when %s initialization finishes late', async path => {
    const loading = await mountPending();
    const loaded = createEmptyTeyvatGameState();
    loaded.图鉴 = normalizeArchiveCodex({ entries: [{ id: 'save-only', name: '玩家自制词条', category: 'term' }], unlockedEntryIds: ['save-only'] });
    await act(async () => state.replaceGameState(loaded));
    const before = state.game.图鉴;
    await finish(loading, path);
    expect(state.game.图鉴).toBe(before);
    expect(state.game.图鉴.entries.map(entry => entry.id)).toEqual(['save-only']);
    expect(state.game.图鉴.unlockedEntryIds).toEqual(['save-only']);
  });

  it.each(['normal', 'fallback'])('still installs startup resources on unchanged session (%s)', async path => {
    const loading = await mountPending();
    await finish(loading, path);
    expect(state.game.图鉴.entries.some(entry => entry.name === '启动资料')).toBe(true);
  });

  it('shows startup storage failure without an unhandled rejected promise or resetting the live game', async () => {
    io.hasAnySave.mockRejectedValueOnce(new Error('fixture storage access denied'));
    const loading = await mountPending();
    const game = state.game;
    await finish(loading, 'normal');
    expect(state.workflowHint).toContain('初始化未完成');
    expect(state.workflowHint).toContain('本地');
    expect(state.game.旅行者).toBe(game.旅行者);
  });
});
