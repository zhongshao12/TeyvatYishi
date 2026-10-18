import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState, type TeyvatSaveData } from '@/models/teyvat';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import { buildSavePayload, clearActiveSaveTreeMetaIfMatches, commitActiveSaveTreeMeta, handleManualSave } from '@/hooks/useGame/saveLoadWorkflow';
import { getSaveCatalogSnapshot, loadSave, saveGame } from '@/services/dbService';
import { getSaveTreeMeta } from '@/utils/saveTree';

function stateFor() {
  const game = createEmptyTeyvatGameState();
  game.旅行者.姓名 = '云';
  return { game, chatHistory: [], variableBatches: [], getGameSessionId: () => 1, setHasSave: () => {}, updateGameState: (update: (root: typeof game) => typeof game) => update(game) } as unknown as UseGameStateReturn;
}
afterEach(() => clearActiveSaveTreeMetaIfMatches());

describe('manual save overwrite contract', () => {
  it('exposes and reloads turns 1 through 10 after overwriting the current manual save at turn 10', async () => {
    clearActiveSaveTreeMetaIfMatches(); const state = stateFor(), manualId = await handleManualSave(state);
    const ids: number[] = [];
    for (let turn = 1; turn <= 10; turn++) {
      state.game.turnCount = turn; state.game.旅行者.身份 = `第${turn}回合的状态`;
      const payload = buildSavePayload(state, 'auto', undefined, state.game), id = await saveGame(payload);
      ids.push(id); commitActiveSaveTreeMeta({ ...payload, id });
    }
    expect(await handleManualSave(state)).toBe(manualId);
    const catalog = await getSaveCatalogSnapshot(), rootId = getSaveTreeMeta((await loadSave(manualId))!)!.rootId;
    const history = catalog.items.filter(item => item.type === 'auto' && item.saveTree?.rootId === rootId);
    expect(history.map(item => item.turnCount).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const [index, id] of ids.entries()) {
      const loaded = await loadSave(id) as unknown as TeyvatSaveData;
      expect(loaded.turnCount).toBe(index + 1); expect(loaded.旅行者.身份).toBe(`第${index + 1}回合的状态`);
    }
    expect((await loadSave(manualId))?.turnCount).toBe(10);
  });
  it('loading an older autosave in the same tree targets its own manual ancestor, not the latest branch', async () => {
    clearActiveSaveTreeMetaIfMatches(); const state = stateFor();
    const first = await handleManualSave(state);
    const firstAuto = buildSavePayload(state, 'auto', undefined, state.game);
    const autoId = await saveGame(firstAuto); commitActiveSaveTreeMeta({ ...firstAuto, id: autoId });
    const otherBranch = await handleManualSave(state, { asNewNode: true });
    expect(otherBranch).not.toBe(first);
    commitActiveSaveTreeMeta({ ...firstAuto, id: autoId }, { loaded: true });
    expect(await handleManualSave(state)).toBe(first);
  });
  it('discards a queued manual save after switching sessions', async () => {
    clearActiveSaveTreeMetaIfMatches(); const state = stateFor(); let session = 1;
    state.getGameSessionId = () => session;
    const first = handleManualSave(state);
    const queued = handleManualSave(state).catch(error => error);
    session = 2;
    await first;
    expect((await queued).message).toBe('MANUAL_SAVE_SESSION_CHANGED');
  });
  it('repeated and concurrent saves keep one manual ID; save-as creates another node', async () => {
    clearActiveSaveTreeMetaIfMatches();
    const state = stateFor();
    const ids = await Promise.all([handleManualSave(state), handleManualSave(state)]);
    expect(ids[1]).toBe(ids[0]);
    const before = await loadSave(ids[0]!);
    state.game.turnCount = 6;
    expect(await handleManualSave(state)).toBe(ids[0]);
    const updated = await loadSave(ids[0]!);
    expect(updated!.turnCount).toBe(6);
    expect(getSaveTreeMeta(updated!)).toEqual(getSaveTreeMeta(before!));
    const nextId = await handleManualSave(state, { asNewNode: true });
    expect(nextId).not.toBe(ids[0]);
    expect(getSaveTreeMeta((await loadSave(nextId))!)!.parentNodeId).toBe(getSaveTreeMeta(updated!)!.nodeId);
    expect(await handleManualSave(state)).toBe(nextId);
  });
  it('keeps historical delta autosaves unchanged when their manual base is overwritten', async () => {
    clearActiveSaveTreeMetaIfMatches();
    const state = stateFor();
    const manualId = await handleManualSave(state);
    state.game.turnCount = 1;
    const auto = buildSavePayload(state, 'auto', undefined, state.game);
    const autoId = await saveGame(auto);
    commitActiveSaveTreeMeta({ ...auto, id: autoId });
    state.game.旅行者.姓名 = '新名字';
    expect(await handleManualSave(state)).toBe(manualId);
    expect((await loadSave(autoId) as unknown as TeyvatSaveData).旅行者.姓名).toBe('云');
    expect((await loadSave(manualId) as unknown as TeyvatSaveData).旅行者.姓名).toBe('新名字');
  });
  it('restores the manual target from an autosave after runtime bookkeeping is cleared', async () => {
    clearActiveSaveTreeMetaIfMatches();
    const state = stateFor();
    const manualId = await handleManualSave(state);
    const auto = buildSavePayload(state, 'auto', undefined, state.game);
    const autoId = await saveGame(auto);
    clearActiveSaveTreeMetaIfMatches();
    commitActiveSaveTreeMeta({ ...auto, id: autoId });
    expect(await handleManualSave(state)).toBe(manualId);
  });
  it('never reuses the manual file of a different same-name game', async () => {
    clearActiveSaveTreeMetaIfMatches();
    const first = await handleManualSave(stateFor());
    clearActiveSaveTreeMetaIfMatches();
    const second = await handleManualSave(stateFor());
    expect(second).not.toBe(first);
    expect(getSaveTreeMeta((await loadSave(first))!)!.rootId).not.toBe(getSaveTreeMeta((await loadSave(second))!)!.rootId);
  });
  it('rejects attempts to overwrite a different tree or an automatic slot', async () => {
    clearActiveSaveTreeMetaIfMatches();
    const state = stateFor();
    const id = await handleManualSave(state);
    clearActiveSaveTreeMetaIfMatches();
    const other = buildSavePayload(state, 'manual', undefined, state.game);
    await expect(saveGame(other, { overwriteManualId: id })).rejects.toThrow('MANUAL_SAVE_TARGET_MISMATCH');
    commitActiveSaveTreeMeta((await loadSave(id))!);
    const auto = buildSavePayload(state, 'auto', undefined, state.game);
    const autoId = await saveGame(auto);
    await expect(saveGame({ ...auto, type: 'manual' } as typeof auto, { overwriteManualId: autoId })).rejects.toThrow('MANUAL_SAVE_TARGET_MISMATCH');
    const catalog = await getSaveCatalogSnapshot();
    expect(catalog.items.some(save => save.id === id)).toBe(true);
  });
});
