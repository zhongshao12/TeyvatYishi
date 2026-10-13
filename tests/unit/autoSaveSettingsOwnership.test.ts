import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import { 创建默认游戏设置 } from '@/models/settings';
import { createLegacyGameViewSelector, type UseGameStateReturn } from '@/hooks/useGameState';
import { runAutoSaveStage } from '@/hooks/useGame/autoSaveStage';
import { clearActiveSaveTreeMetaIfMatches } from '@/hooks/useGame/saveLoadWorkflow';
import { createWorkflowRecoveryJournal, WORKFLOW_RECOVERY_KEY } from '@/services/workflowRecovery';

const database = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  saveGame: vi.fn(async (_payload: unknown) => 1),
}));
vi.mock('@/services/dbService', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/dbService')>(),
  loadSetting: async (key: string) => database.store.get(key) ?? null,
  saveSetting: async (key: string, value: unknown) => { database.store.set(key, value); },
  deleteSetting: async (key: string) => { database.store.delete(key); },
  saveSettings: async (settings: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(settings)) database.store.set(key, value);
  },
  saveGame: (payload: unknown) => database.saveGame(payload),
}));

describe('turn-end settings ownership (A03)', () => {
  beforeEach(() => {
    database.store.clear();
    database.saveGame.mockReset().mockResolvedValue(1);
    clearActiveSaveTreeMetaIfMatches();
  });

  it.each([false, true])('preserves newer settings with auto-save %s while retaining save/log behavior', async enabled => {
    const game = createEmptyTeyvatGameState();
    const settings = 创建默认游戏设置();
    settings.enableAutoSaveEveryTurn = enabled;
    const setHasSave = vi.fn();
    const state = {
      ...createLegacyGameViewSelector()(game), game, gameSettings: settings, currentTheme: 'old-theme',
      apiSettings: { activeConfigId: 'old', configs: [] }, worldbooks: [],
      chatHistory: [], variableBatches: [], turnCount: 1,
      getGameSessionId: () => 1,
      updateGameState: (update: (value: typeof game) => typeof game) => { update(game); },
      setQueueTasks: () => {}, setHasSave,
    } as unknown as UseGameStateReturn;
    const latestSettings: Record<string, unknown> = {
      theme: 'new-theme', apiSettings: { activeConfigId: 'new', configs: [] },
      gameSettings: { wordCount: 3000 }, worldbooks: [{ id: 'player-edited' }],
    };
    let releaseSave: (() => void) | undefined;
    if (enabled) database.saveGame.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { releaseSave = resolve; });
      return 1;
    });
    // The snapshot is already captured; settings may change before or during the final save.
    if (!enabled) for (const [key, value] of Object.entries(latestSettings)) database.store.set(key, value);
    const pending = runAutoSaveStage({
      state, assertWorkflowActive: () => {},
      committedSettlementGame: game, variableOverrides: {},
      steambirdAfterGeneration: game.蒸汽鸟报, travelerAfterMastery: state.旅人,
      finalHistoryForSave: [], memoryAfterStoryProgress: state.记忆,
      irminsulAfterTurnRecall: game.世界树, courierAfterFallbackSeed: game.手机,
      npcAfterCompression: state.NPC, storyWeavingForSave: state.剧情编织,
      codexAfterRuntimeUnlock: game.图鉴,
      recoveryJournal: createWorkflowRecoveryJournal('继续', 1), onJournalUpdated: () => {},
    });
    if (enabled) {
      await vi.waitFor(() => expect(releaseSave).toBeTypeOf('function'));
      for (const [key, value] of Object.entries(latestSettings)) database.store.set(key, value);
      releaseSave!();
    }
    await pending;
    for (const [key, value] of Object.entries(latestSettings)) expect(database.store.get(key), key).toBe(value);
    expect(database.store.has(WORKFLOW_RECOVERY_KEY)).toBe(false);
    expect(database.saveGame).toHaveBeenCalledTimes(enabled ? 1 : 0);
    expect(setHasSave).toHaveBeenCalledTimes(enabled ? 1 : 0);
  });
});
