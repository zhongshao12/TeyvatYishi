// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useGameState, type UseGameStateReturn } from '@/hooks/useGameState';

vi.mock('@/services/dbService', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/dbService')>(),
  loadSetting: vi.fn(async () => null),
  saveSetting: vi.fn(async () => undefined),
  hasAnySave: vi.fn(async () => false),
}));
vi.mock('@/services/workflowRecovery', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/services/workflowRecovery')>(),
  loadWorkflowRecoveryJournal: vi.fn(async () => null),
}));
vi.mock('@/data/storyWeavingPreset', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/data/storyWeavingPreset')>();
  const { 创建空剧情编织系统 } = await import('@/models/storyWeaving');
  return { ...original, loadAllBundledStoryWeavingPresets: vi.fn(async () => 创建空剧情编织系统()) };
});
vi.mock('@/data/codexPreset', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/data/codexPreset')>(),
  loadAllBundledCodexPresets: vi.fn(async () => ({ 条目: [] })),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('global Tavern settings selection', () => {
  it('clears a retired preset ID supplied through the settings setter', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let state: UseGameStateReturn | null = null;
    function Harness() {
      state = useGameState();
      return null;
    }
    try {
      await act(async () => root.render(createElement(Harness)));
      await act(async () => {
        state!.setGameSettings((current) => ({
          ...current,
          currentStPresetIdV2: 'builtin_izumi_v2',
        }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(state!.gameSettings.currentStPresetIdV2).toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
