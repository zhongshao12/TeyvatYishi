import { beforeEach, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import { applySaveToState, handleManualSave } from '@/hooks/useGame/saveLoadWorkflow';
import { runAutoSaveStage, type RunAutoSaveStageDeps } from '@/hooks/useGame/autoSaveStage';
import { persistMemorySnapshot } from '@/hooks/useGame/memorySaveTask';
import { saveStatusStore } from '@/utils/saveStatus';
import { 创建默认游戏设置 } from '@/models/settings';
import { 创建空记忆系统 } from '@/models/memory';

const db = vi.hoisted(() => ({ saveGame: vi.fn() }));
vi.mock('@/services/dbService', () => ({
  saveGame: db.saveGame,
  saveSetting: vi.fn(async () => {}),
  saveSettings: vi.fn(async () => {}),
  loadSetting: vi.fn(async () => null),
  deleteSetting: vi.fn(async () => {}),
  loadSave: vi.fn(),
  loadLatestSave: vi.fn(),
  deleteSave: vi.fn(),
}));

let sessionId = 100;
beforeEach(() => {
  sessionId += 1;
  db.saveGame.mockReset();
});

function stateFor(game = createEmptyTeyvatGameState()) {
  const setHasSave = vi.fn();
  const settings = 创建默认游戏设置();
  const state = {
    game, chatHistory: [], variableBatches: [],
    getGameSessionId: () => sessionId,
    updateGameState: (update: (current: typeof game) => typeof game) => { update(game); },
    setHasSave, setQueueTasks: vi.fn(), turnCount: 0,
    gameSettings: settings, currentTheme: 'mondstadt',
    apiSettings: { activeConfigId: null, configs: [] }, worldbooks: [],
  } as unknown as UseGameStateReturn;
  return { state, setHasSave };
}

it('reports manual write progress and only marks saved after the database resolves', async () => {
  const { state, setHasSave } = stateFor();
  let finish!: (id: number) => void;
  db.saveGame.mockImplementation(() => new Promise<number>((resolve) => { finish = resolve; }));
  const pending = handleManualSave(state);
  expect(saveStatusStore.getSnapshot()).toMatchObject({ sessionId, phase: 'saving', source: 'manual' });
  expect(setHasSave).not.toHaveBeenCalled();
  finish(41);
  await expect(pending).resolves.toBe(41);
  expect(saveStatusStore.getSnapshot()).toMatchObject({ sessionId, phase: 'saved', source: 'manual' });
  expect(setHasSave).toHaveBeenCalledWith(true);
});

it('keeps a failed manual save visible and does not mark it persisted', async () => {
  const { state, setHasSave } = stateFor();
  db.saveGame.mockRejectedValueOnce(new Error('test disk error'));
  await expect(handleManualSave(state)).rejects.toThrow('test disk error');
  expect(saveStatusStore.getSnapshot()).toMatchObject({ sessionId, phase: 'failed', source: 'manual' });
  expect(setHasSave).not.toHaveBeenCalled();
});

it('does not apply an old session manual save completion to a newly loaded session', async () => {
  const { state } = stateFor();
  let finish!: (id: number) => void;
  db.saveGame.mockImplementation(() => new Promise<number>((resolve) => { finish = resolve; }));
  const pending = handleManualSave(state);
  const newSession = sessionId + 1;
  saveStatusStore.observeGame(newSession, createEmptyTeyvatGameState());
  finish(52);
  await pending;
  expect(saveStatusStore.getSnapshot()).toMatchObject({ sessionId: newSession, phase: 'unsaved' });
});

it('writes the same live game root that the manual-save badge claims was persisted', async () => {
  const stale = createEmptyTeyvatGameState();
  const live = { ...stale, turnCount: 1 };
  const { state } = stateFor(stale);
  state.updateGameState = (update) => { update(live); };
  db.saveGame.mockResolvedValueOnce(53);
  await handleManualSave(state);
  expect(db.saveGame.mock.calls[0]?.[0]).toMatchObject({ turnCount: 1 });
  expect(saveStatusStore.getSnapshot()).toMatchObject({ sessionId, phase: 'saved' });
});

it('reports the real post-turn auto-save only after its database write completes', async () => {
  const { state, setHasSave } = stateFor();
  state.gameSettings.enableAutoSaveEveryTurn = true;
  let finish!: (id: number) => void;
  db.saveGame.mockImplementation(() => new Promise<number>((resolve) => { finish = resolve; }));
  const deps = {
    state, assertWorkflowActive: () => {},
    recoveryJournal: { workflowId: 'journal-1', phase: 'settlement_committed' },
    onJournalUpdated: vi.fn(),
  } as unknown as RunAutoSaveStageDeps;
  const pending = runAutoSaveStage(deps);
  expect(saveStatusStore.getSnapshot()).toMatchObject({ sessionId, phase: 'saving', source: 'auto' });
  finish(61);
  await pending;
  expect(saveStatusStore.getSnapshot()).toMatchObject({ sessionId, phase: 'saved', source: 'auto' });
  expect(setHasSave).toHaveBeenCalledWith(true);
});

it('does not announce a write when post-turn autosave is disabled', async () => {
  const { state } = stateFor();
  state.gameSettings.enableAutoSaveEveryTurn = false;
  saveStatusStore.observeGame(sessionId, state.game);
  await runAutoSaveStage({
    state, assertWorkflowActive: () => {},
    recoveryJournal: { workflowId: 'journal-2', phase: 'settlement_committed' },
    onJournalUpdated: vi.fn(),
  } as unknown as RunAutoSaveStageDeps);
  expect(saveStatusStore.getSnapshot()).toMatchObject({ sessionId, phase: 'unsaved' });
  expect(db.saveGame).not.toHaveBeenCalled();
});

it('replaces an older failure with the loaded save status for the new session', async () => {
  const game = createEmptyTeyvatGameState();
  const { state } = stateFor(game);
  saveStatusStore.fail(saveStatusStore.begin(sessionId, game, 'auto'));
  let currentSession = sessionId;
  state.getGameSessionId = () => currentSession;
  state.replaceGameState = vi.fn(() => { currentSession += 1; });
  state.setView = vi.fn();
  state.interruptedWorkflow = null;
  await applySaveToState({ ...game, id: 9, type: 'manual', timestamp: 789 }, state);
  expect(saveStatusStore.getSnapshot()).toMatchObject({
    sessionId: currentSession, phase: 'saved', source: 'loaded', savedAt: 789,
  });
});

it('persists a memory edit against the live game rather than an older rendered root', async () => {
  const stale = createEmptyTeyvatGameState();
  const live = { ...stale, turnCount: 1 };
  const { state, setHasSave } = stateFor(stale);
  state.updateGameState = (update) => { update(live); };
  db.saveGame.mockResolvedValueOnce(88);
  await persistMemorySnapshot(state, 创建空记忆系统());
  expect(db.saveGame.mock.calls[0]?.[0]).toMatchObject({ turnCount: 1 });
  expect(saveStatusStore.getSnapshot()).toMatchObject({ sessionId, phase: 'saved', source: 'auto' });
  expect(setHasSave).toHaveBeenCalledWith(true);
});
