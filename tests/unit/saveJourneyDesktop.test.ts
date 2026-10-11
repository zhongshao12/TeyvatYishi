import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const disk = vi.hoisted(() => {
  const files = new Map<string, string>();
  return { files,
    readText: async (path: string) => files.get(path) ?? null,
    writeTextExclusive: vi.fn(async (path: string, value: string) => { if (files.has(path)) return false; files.set(path, value); return true; }),
    readJson: async (path: string) => files.has(path) ? JSON.parse(files.get(path)!) : null,
    writeJson: vi.fn(async (path: string, value: unknown) => { files.set(path, JSON.stringify(value)); }),
    remove: async (path: string) => { files.delete(path); },
    list: async (prefix: string) => [...files.keys()].filter(path => path.startsWith(`${prefix}/`)).map(path => path.slice(prefix.length + 1)),
  };
});
vi.mock('@/utils/platform/desktopRuntime', () => ({ isDesktopRuntime: () => true }));
vi.mock('@/services/storage/appStorageAdapter', () => ({ createAppStorageAdapter: () => disk }));
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import { getSaveCatalogSnapshot, loadSave, saveGame } from '@/services/dbService';
import { openGameDatabase, SAVES_STORE, SAVE_SUMMARIES_STORE, SAVE_ASSETS_STORE, SAVE_NODE_DELTAS_STORE, SETTINGS_STORE } from '@/services/storage/gameDatabase';
import { attachSaveJourneyLabels, SAVE_JOURNEY_REGISTRY_PATH } from '@/services/storage/saveJourneyRegistry';
import { getSaveJourneyLabel } from '@/utils/saveJourneyLabel';
import { listDesktopSaveMirror, loadDesktopSaveMirrorSaves, inspectDesktopSaveMirrorHealth } from '@/services/desktop/desktopSaveMirror';
import type { SaveListItemSummary } from '@/services/storage/saveCatalog';

const snapshot = (items: SaveListItemSummary[]) => ({ items, legacyBackups: [], pendingIds: [], unreadableIds: [], staleCatalogIds: [], hiddenBaseCount: 0, totalStoredCount: items.length, catalogComplete: true });
const summary = (id: number, rootId: string): SaveListItemSummary => ({ id, type: 'auto', timestamp: id, travelerName: '云', turnCount: 1,
  universe: 'teyvat', schemaVersion: 2, saveTree: { rootId, nodeId: `node-${id}`, createdAt: id },
  worldPeriodName: '', currentDate: '', currentTime: '', currentLocation: '', lastSummary: '', sizeBytes: 1 });
async function clearIndexed() {
  const db = await openGameDatabase(); const stores = [SAVES_STORE, SAVE_SUMMARIES_STORE, SAVE_ASSETS_STORE, SAVE_NODE_DELTAS_STORE, SETTINGS_STORE];
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(stores, 'readwrite'); stores.forEach(store => tx.objectStore(store).clear()); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
}
beforeEach(async () => { disk.files.clear(); disk.writeJson.mockClear(); disk.writeTextExclusive.mockClear(); await clearIndexed(); });
describe('desktop journey registry and distinct round retention', () => {
  it('allocates disjoint roots atomically in separate module instances and persists only on new allocations', async () => {
    vi.resetModules(); const a = await import('@/services/storage/saveJourneyRegistry');
    vi.resetModules(); const b = await import('@/services/storage/saveJourneyRegistry');
    const [one, two] = await Promise.all([a.attachSaveJourneyLabels(snapshot([summary(1, 'a')])), b.attachSaveJourneyLabels(snapshot([summary(2, 'b')]))]);
    expect(new Set([...one.items, ...two.items].map(getSaveJourneyLabel))).toEqual(new Set(['云01', '云02']));
    disk.writeJson.mockClear(); disk.writeTextExclusive.mockClear();
    expect((await attachSaveJourneyLabels(snapshot([summary(2, 'b')]))).items.map(getSaveJourneyLabel)).toEqual(['云02']);
    expect(disk.writeJson).not.toHaveBeenCalled();
    expect(disk.writeTextExclusive).not.toHaveBeenCalled();
    expect((await attachSaveJourneyLabels(snapshot([summary(3, 'c')]))).items.map(getSaveJourneyLabel)).toEqual(['云03']);
  });
  it('reads already numbered full catalogs without creating a lock or writing the registry', async () => {
    const game = createEmptyTeyvatGameState(); game.旅行者.姓名 = '云';
    await saveGame({ ...game, type: 'manual', timestamp: 1, saveTree: { rootId: 'a', nodeId: 'a1', createdAt: 1 } } as never);
    const first = await getSaveCatalogSnapshot(); expect(first.items.map(getSaveJourneyLabel)).toEqual(['云01']);
    const filesBefore = [...disk.files]; disk.writeJson.mockClear(); disk.writeTextExclusive.mockClear();
    expect((await getSaveCatalogSnapshot()).items.map(getSaveJourneyLabel)).toEqual(['云01']);
    expect(disk.writeTextExclusive).not.toHaveBeenCalled(); expect(disk.writeJson).not.toHaveBeenCalled();
    expect([...disk.files]).toEqual(filesBefore);
  });
  it.each(['{broken', 'null', '', '{"version":1,"roots":[],"counters":[{"name":"云","lastOrdinal":-1}]}'])('refuses corrupt registries without resetting or overwriting: %s', async raw => {
    disk.files.set(SAVE_JOURNEY_REGISTRY_PATH, raw);
    await expect(attachSaveJourneyLabels(snapshot([summary(1, 'a')]))).rejects.toThrow();
    expect(disk.files.get(SAVE_JOURNEY_REGISTRY_PATH)).toBe(raw); expect(disk.writeJson).not.toHaveBeenCalled();
    expect(disk.files.has('locks/save-journey-registry.lock')).toBe(false);
  });
  it('rejects write failure, preserves old associations, and releases the lock for a safe retry', async () => {
    await attachSaveJourneyLabels(snapshot([summary(1, 'a')])); const before = disk.files.get(SAVE_JOURNEY_REGISTRY_PATH);
    disk.writeJson.mockRejectedValueOnce(new Error('编号主文件写入失败'));
    await expect(attachSaveJourneyLabels(snapshot([summary(2, 'b')]))).rejects.toThrow('编号主文件写入失败');
    expect(disk.files.get(SAVE_JOURNEY_REGISTRY_PATH)).toBe(before);
    expect((await attachSaveJourneyLabels(snapshot([summary(2, 'b')]))).items.map(getSaveJourneyLabel)).toEqual(['云02']);
  });
  it('retains ten rounds per root, branches, and loads every desktop-only node through its hidden checkpoint', async () => {
    for (const rootId of ['a', 'b']) {
      for (let turn = 0; turn <= 11; turn++) {
        const game = createEmptyTeyvatGameState(); game.turnCount = turn; game.旅行者.姓名 = '云';
        game.对话.entries = Array.from({ length: turn + 1 }, (_, i) => ({ id: `${rootId}-${i}`, role: 'assistant', content: `完整 ${i}`, timestamp: i } as never));
        await saveGame({ ...game, type: 'auto', timestamp: turn + 1, saveTree: { rootId, nodeId: `${rootId}-${turn}`, parentNodeId: turn ? `${rootId}-${turn - 1}` : undefined, createdAt: turn + 1 } } as never);
      }
      const latest = (await getSaveCatalogSnapshot()).items.find(item => item.saveTree?.nodeId === `${rootId}-11`)!;
      await saveGame({ ...await loadSave(latest.id), id: 0, timestamp: 100, saveTree: { rootId, nodeId: `${rootId}-branch`, parentNodeId: `${rootId}-10`, createdAt: 100 } } as never);
    }
    await clearIndexed(); const catalog = await getSaveCatalogSnapshot();
    expect(catalog.items).toHaveLength(22); expect(catalog.hiddenBaseCount).toBeGreaterThan(0);
    for (const rootId of ['a', 'b']) {
      const nodes = catalog.items.filter(item => item.saveTree?.rootId === rootId);
      expect(new Set(nodes.map(item => item.turnCount)).size).toBe(10); expect(nodes.filter(item => item.turnCount === 11)).toHaveLength(2);
      expect(new Set(nodes.map(getSaveJourneyLabel)).size).toBe(1);
    }
    expect(new Set(catalog.items.map(getSaveJourneyLabel)).size).toBe(2);
    for (const item of catalog.items) {
      const loaded = await loadSave(item.id) as unknown as ReturnType<typeof createEmptyTeyvatGameState>;
      expect(loaded.对话.entries).toHaveLength(item.turnCount + 1); expect(loaded.旅行者.姓名).toBe('云');
      expect(loaded.对话.entries[item.turnCount]!.content).toBe(`完整 ${item.turnCount}`);
    }
    // Force index reconstruction and actual directory scan; registry is not a save candidate.
    disk.files.delete('saves/index.json');
    const rebuilt = await listDesktopSaveMirror({ includeHidden: true });
    expect(rebuilt).toHaveLength(catalog.totalStoredCount);
    const health = await inspectDesktopSaveMirrorHealth(); expect(health!.invalidSaveFiles).toBe(0); expect(health!.saveFiles).toBe(catalog.totalStoredCount);
    expect(await loadDesktopSaveMirrorSaves({ strict: true })).toHaveLength(catalog.totalStoredCount);
  });
});
