import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => {
  const records = new Map<string, unknown>();
  return {
    records,
    readJson: vi.fn(async (path: string) => records.get(path) ?? null),
    writeJson: vi.fn(async (path: string, value: unknown) => { records.set(path, JSON.parse(JSON.stringify(value))); }),
    readText: async (path: string) => {
      const value = records.get(path);
      return value === undefined ? null : typeof value === 'string' ? value : JSON.stringify(value);
    },
    writeText: async (path: string, value: unknown) => { records.set(path, value); },
    writeTextExclusive: async (path: string, value: unknown) => { if (records.has(path)) return false; records.set(path, value); return true; },
    remove: async (path: string) => { records.delete(path); },
    list: vi.fn(async (prefix: string) => [...records.keys()].filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length).replace(/^\//, ''))),
  };
});
vi.mock('@/utils/platform/desktopRuntime', () => ({ isDesktopRuntime: () => true }));
vi.mock('@/services/storage/appStorageAdapter', () => ({ createAppStorageAdapter: () => storage }));
import { createEmptyTeyvatGameState, type TeyvatSaveData } from '@/models/teyvat';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import { buildSavePayload, clearActiveSaveTreeMetaIfMatches, commitActiveSaveTreeMeta, handleManualSave } from '@/hooks/useGame/saveLoadWorkflow';
import { loadSave, saveGame } from '@/services/dbService';
import { openGameDatabase, SAVES_STORE, SAVE_NODE_DELTAS_STORE } from '@/services/storage/gameDatabase';

function stateFor() {
  const game = createEmptyTeyvatGameState(); game.旅行者.姓名 = '旧旅行者';
  return { game, chatHistory: [], variableBatches: [], getGameSessionId: () => 1, setHasSave: () => {}, updateGameState: (update: (root: typeof game) => typeof game) => update(game) } as unknown as UseGameStateReturn;
}
afterEach(() => { clearActiveSaveTreeMetaIfMatches(); storage.writeJson.mockClear(); });
describe('desktop manual file replacement', () => {
  it('serializes another module instance across dependency scanning and manual replacement', async () => {
    clearActiveSaveTreeMetaIfMatches(); const state = stateFor();
    const id = await handleManualSave(state);
    const oldAuto = buildSavePayload(state, 'auto', undefined, state.game);
    const previous = (storage.records.get(`saves/save-${id}.json`) as { save: TeyvatSaveData }).save;
    const next = { ...previous, 旅行者: { ...previous.旅行者, 姓名: '另一版本的旅行者' } };
    vi.resetModules();
    const other = await import('@/services/dbService');
    let reached!: () => void, release!: () => void, contended!: () => void;
    const scanned = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const contention = new Promise<void>(resolve => { contended = resolve; });
    const write = storage.writeJson.getMockImplementation()!;
    const exclusive = storage.writeTextExclusive;
    const spy = vi.spyOn(storage, 'writeTextExclusive').mockImplementation(async (path, value) => {
      const acquired = await exclusive(path, value);
      if (path === 'locks/save-mutations.lock' && !acquired) contended();
      return acquired;
    });
    storage.writeJson.mockImplementation(async (path, value) => {
      if (path.startsWith(`saves/transactions/save-${id}-`)) { reached(); await gate; }
      await write(path, value);
    });
    const overwrite = saveGame(next, { overwriteManualId: id });
    let append: Promise<number> | undefined;
    try {
      await scanned;
      append = other.saveGame(oldAuto);
      // Deterministic interleaving: the old implementation completes B here;
      // a lifecycle mutex makes B contend before it can select a base.
      await Promise.race([append.then(() => undefined), contention]);
      release();
      await overwrite;
      const autoId = await append;
      expect((await loadSave(autoId) as unknown as TeyvatSaveData).旅行者.姓名).toBe('旧旅行者');
    } finally {
      release(); await Promise.allSettled([overwrite, ...(append ? [append] : [])]);
      storage.writeJson.mockImplementation(write); spy.mockRestore();
    }
  });
  it('builds an automatic delta from the authoritative file when the IDB compatibility copy is stale', async () => {
    clearActiveSaveTreeMetaIfMatches(); const state = stateFor();
    const id = await handleManualSave(state);
    const db = await openGameDatabase();
    const oldCopy = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(SAVES_STORE).objectStore(SAVES_STORE).get(id);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    state.game.旅行者.姓名 = '已更新的桌面基线';
    expect(await handleManualSave(state)).toBe(id);
    // A successful primary-file save may leave this compatibility copy old if
    // the browser transaction fails. Recreate that documented storage state.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SAVES_STORE, 'readwrite'); tx.objectStore(SAVES_STORE).put(oldCopy);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    state.game.旅行者.姓名 = '旧旅行者'; state.game.turnCount = 2;
    const autoId = await saveGame(buildSavePayload(state, 'auto', undefined, state.game));
    expect((await loadSave(autoId) as unknown as TeyvatSaveData).旅行者.姓名).toBe('旧旅行者');
  });
  it('reports failure rather than claiming an IDB-only update when the existing primary file cannot be replaced', async () => {
    clearActiveSaveTreeMetaIfMatches(); const state = stateFor();
    const id = await handleManualSave(state);
    const implementation = storage.writeJson.getMockImplementation()!;
    storage.writeJson.mockImplementation(async (path, value) => { if (path === `saves/save-${id}.json`) throw new Error('主文件被占用'); await implementation(path, value); });
    state.game.旅行者.姓名 = '不应假称保存成功';
    try {
      await expect(handleManualSave(state)).rejects.toThrow('主文件被占用');
      expect((await loadSave(id) as unknown as TeyvatSaveData).旅行者.姓名).toBe('旧旅行者');
    } finally { storage.writeJson.mockImplementation(implementation); }
  });
  it('refuses to select a stale compatibility base when its authoritative file is unreadable', async () => {
    clearActiveSaveTreeMetaIfMatches(); const state = stateFor();
    const id = await handleManualSave(state);
    const read = storage.readJson.getMockImplementation()!;
    storage.readJson.mockImplementation(async path => {
      if (path === `saves/save-${id}.json`) throw new Error('主文件不可读');
      return read(path);
    });
    try {
      await expect(saveGame(buildSavePayload(state, 'auto', undefined, state.game))).rejects.toThrow('主文件不可读');
    } finally { storage.readJson.mockImplementation(read); }
  });
  it('updates the same file and materializes dependent automatic files before changing their base', async () => {
    const previousFileCount = [...storage.records.keys()].filter(path => /^saves\/save-\d+\.json$/.test(path)).length;
    clearActiveSaveTreeMetaIfMatches(); const state = stateFor();
    const id = await handleManualSave(state);
    state.game.turnCount = 2;
    const auto = buildSavePayload(state, 'auto', undefined, state.game);
    const autoId = await saveGame(auto); commitActiveSaveTreeMeta({ ...auto, id: autoId });
    const file = `saves/save-${id}.json`;
    state.game.旅行者.姓名 = '新旅行者';
    expect(await handleManualSave(state)).toBe(id);
    expect((await loadSave(autoId) as unknown as TeyvatSaveData).旅行者.姓名).toBe('旧旅行者');
    expect((await loadSave(id) as unknown as TeyvatSaveData).旅行者.姓名).toBe('新旅行者');
    expect([...storage.records.keys()].filter(path => /^saves\/save-\d+\.json$/.test(path))).toEqual(expect.arrayContaining([file, `saves/save-${autoId}.json`]));
    expect([...storage.records.keys()].filter(path => /^saves\/save-\d+\.json$/.test(path))).toHaveLength(previousFileCount + 2);
  });
  it('does not overwrite the base when a dependent history file cannot be frozen', async () => {
    clearActiveSaveTreeMetaIfMatches(); const state = stateFor();
    const id = await handleManualSave(state);
    const auto = buildSavePayload(state, 'auto', undefined, state.game);
    const autoId = await saveGame(auto); commitActiveSaveTreeMeta({ ...auto, id: autoId });
    const implementation = storage.writeJson.getMockImplementation()!;
    storage.writeJson.mockImplementation(async (path, value) => { if (path === `saves/save-${autoId}.json`) throw new Error('文件被占用'); await implementation(path, value); });
    state.game.旅行者.姓名 = '不应写入';
    try {
      await expect(handleManualSave(state)).rejects.toThrow('文件被占用');
      expect((await loadSave(id) as unknown as TeyvatSaveData).旅行者.姓名).toBe('旧旅行者');
    } finally { storage.writeJson.mockImplementation(implementation); }
  });
  it.each(['delta read', 'directory scan', 'history file read'])('does not replace the base when desktop-only history is unavailable: %s', async (failure) => {
    clearActiveSaveTreeMetaIfMatches(); const state = stateFor();
    const id = await handleManualSave(state);
    const auto = buildSavePayload(state, 'auto', undefined, state.game);
    const autoId = await saveGame(auto); commitActiveSaveTreeMeta({ ...auto, id: autoId });
    const nodeId = (auto as typeof auto & { saveTree: { nodeId: string } }).saveTree.nodeId;
    const deltaPath = `saves/deltas/delta-${encodeURIComponent(nodeId)}.json`;
    expect(storage.records.get(deltaPath)).toMatchObject({ delta: { deltaPayload: { baseSaveId: id } } });
    const db = await openGameDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SAVE_NODE_DELTAS_STORE, 'readwrite');
      tx.objectStore(SAVE_NODE_DELTAS_STORE).delete(nodeId);
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    const read = storage.readJson.getMockImplementation()!;
    const list = storage.list.getMockImplementation()!;
    if (failure !== 'directory scan') storage.readJson.mockImplementation(async path => {
      if (path === (failure === 'delta read' ? deltaPath : `saves/save-${autoId}.json`)) throw new Error('历史文件暂时不可读'); return read(path);
    });
    else {
      storage.records.delete('saves/deltas/index.json');
      storage.list.mockImplementation(async prefix => { if (prefix === 'saves/deltas') throw new Error('历史目录暂时不可读'); return list(prefix); });
    }
    state.game.旅行者.姓名 = '不得改变旧基线';
    try {
      await expect(handleManualSave(state)).rejects.toThrow(/历史/);
      expect(storage.records.get(`saves/save-${id}.json`)).toMatchObject({ save: { 旅行者: { 姓名: '旧旅行者' } } });
    } finally { storage.readJson.mockImplementation(read); storage.list.mockImplementation(list); }
  });
});
