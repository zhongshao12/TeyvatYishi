import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openGameDatabase, SAVES_STORE, SAVE_SUMMARIES_STORE, SAVE_NODE_DELTAS_STORE, SAVE_ASSETS_STORE, SETTINGS_STORE } from '@/services/storage/gameDatabase';
import { createCatalogRecordFromSummary, type SaveListItemSummary } from '@/services/storage/saveCatalog';
import { deleteSaveTree, getSaveCatalogSnapshot, loadSave, loadSaveTree, saveGame } from '@/services/dbService';
import { buildSaveTreeGroups } from '@/utils/saveTreeView';
import { SAVE_JOURNEY_REGISTRY_KEY } from '@/services/storage/saveJourneyRegistry';
import { getSaveJourneyLabel } from '@/utils/saveJourneyLabel';
import { createEmptyTeyvatGameState } from '@/models/teyvat';

function summary(id: number, rootId?: string, timestamp = id): SaveListItemSummary {
  return { id, universe: 'teyvat', schemaVersion: 2, type: 'auto', timestamp, travelerName: '云', turnCount: id,
    saveTree: rootId ? { rootId, nodeId: `node-${id}`, createdAt: timestamp } : undefined,
    worldPeriodName: '', currentDate: '', currentTime: '', currentLocation: '', lastSummary: '', sizeBytes: 1 };
}
async function seed(items: SaveListItemSummary[]) {
  const db = await openGameDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SAVES_STORE, SAVE_SUMMARIES_STORE], 'readwrite');
    for (const item of items) { tx.objectStore(SAVES_STORE).put({ id: item.id }); tx.objectStore(SAVE_SUMMARIES_STORE).put(createCatalogRecordFromSummary(item)); }
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
const ordinals = (items: SaveListItemSummary[]) => items.map(item => (item as SaveListItemSummary & { journeyOrdinal?: number }).journeyOrdinal);
beforeEach(async () => {
  const db = await openGameDatabase();
  const stores = [SAVES_STORE, SAVE_SUMMARIES_STORE, SAVE_NODE_DELTAS_STORE, SAVE_ASSETS_STORE, SETTINGS_STORE];
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(stores, 'readwrite');
    for (const store of stores) tx.objectStore(store).clear();
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
});
describe('persisted independent journey ordinals', () => {
  it('labels same-name roots without changing player names and shares automatic/manual identity', async () => {
    await seed([summary(1, 'root-a'), summary(2, 'root-b'), { ...summary(3, 'root-a'), type: 'manual' }]);
    const result = await getSaveCatalogSnapshot();
    expect(ordinals(result.items)).toEqual([1, 2, 1]);
    expect(result.items.map(item => item.travelerName)).toEqual(['云', '云', '云']);
  });
  it('does not exchange or reuse ordinals on reorder, deletion, or module reload', async () => {
    await seed([summary(1, 'a'), summary(2, 'b')]); await getSaveCatalogSnapshot();
    const db = await openGameDatabase();
    await new Promise<void>(resolve => { const tx = db.transaction(SAVES_STORE, 'readwrite'); tx.objectStore(SAVES_STORE).delete(1); tx.oncomplete = () => resolve(); });
    await seed([summary(2, 'b', 100), summary(3, 'c')]);
    vi.resetModules(); const reloaded = await import('@/services/dbService');
    expect(ordinals((await reloaded.getSaveCatalogSnapshot()).items)).toEqual([2, 3]);
  });
  it('serializes concurrent allocations from independent module instances', async () => {
    await seed([summary(1, 'a'), summary(2, 'b')]);
    vi.resetModules(); const a = await import('@/services/dbService');
    vi.resetModules(); const b = await import('@/services/dbService');
    const results = await Promise.all([a.getSaveCatalogSnapshot(), b.getSaveCatalogSnapshot()]);
    expect(ordinals(results[0]!.items)).toEqual([2, 1]); expect(ordinals(results[1]!.items)).toEqual([2, 1]);
  });
  it('isolates legacy IDs rather than guessing a journey from same name and monotonic turns', async () => {
    const items = [summary(1), summary(2), summary(3)];
    expect(buildSaveTreeGroups(items)).toHaveLength(3);
    await seed(items); expect(new Set(ordinals((await getSaveCatalogSnapshot()).items)).size).toBe(3);
  });
  it('keeps rootless groups isolated even if an explicit root uses the synthetic legacy name', () => {
    const blank = { ...summary(3), saveTree: { rootId: ' ', nodeId: 'blank', createdAt: 3 } };
    const groups = buildSaveTreeGroups([summary(1), summary(2, 'legacy-root-1'), blank]);
    expect(groups).toHaveLength(3); expect(new Set(groups.map(group => group.rootId)).size).toBe(3);
  });
  it('deletes exactly the selected root without trimming it into another independently labelled journey', async () => {
    const records: Array<{ id: number; rootId: string; content: string }> = [];
    for (const [i, rootId] of [' root-a ', 'root-a'].entries()) {
      const game = createEmptyTeyvatGameState(); game.旅行者.姓名 = '云';
      const content = i === 0 ? '带空格旅程原正文' : '无空格旅程原正文';
      game.对话.entries = [{ id: `dialogue-${i}`, role: 'assistant', content, timestamp: i + 1 } as never];
      const id = await saveGame({ ...game, type: 'manual', timestamp: i + 1,
        saveTree: { rootId, nodeId: `exact-node-${i}`, createdAt: i + 1 } } as never);
      records.push({ id, rootId, content });
    }
    const before = await getSaveCatalogSnapshot();
    expect(before.items.map(item => [item.saveTree?.rootId, item.travelerName, getSaveJourneyLabel(item)])).toEqual([
      ['root-a', '云', '云02'], [' root-a ', '云', '云01'],
    ]);
    expect((await loadSaveTree(' root-a ')).map(save => save.id)).toEqual([records[0]!.id]);
    expect(await deleteSaveTree(' root-a ')).toBe(1);
    const after = await getSaveCatalogSnapshot();
    expect(after.items.map(item => item.id)).toEqual([records[1]!.id]);
    expect(after.items.map(item => [item.saveTree?.rootId, item.travelerName, getSaveJourneyLabel(item)])).toEqual([['root-a', '云', '云02']]);
    expect(await loadSave(records[0]!.id)).toBeNull();
    const surviving = await loadSave(records[1]!.id) as unknown as ReturnType<typeof createEmptyTeyvatGameState>;
    expect(surviving.旅行者.姓名).toBe('云'); expect(surviving.对话.entries[0]!.content).toBe(records[1]!.content);
    expect(await deleteSaveTree(' root-a ')).toBe(0); expect(await deleteSaveTree('   ')).toBe(0);
    expect((await getSaveCatalogSnapshot()).items.map(item => item.id)).toEqual([records[1]!.id]);
  });
  it('keeps name cohorts separate, allocates renamed roots safely, and restores their own old association', async () => {
    await seed([summary(1, 'a'), { ...summary(2, 'b'), travelerName: '风' }]);
    expect((await getSaveCatalogSnapshot()).items.map(getSaveJourneyLabel)).toEqual(['风01', '云01']);
    await seed([{ ...summary(3, 'a'), travelerName: '风' }]);
    const renamed = await getSaveCatalogSnapshot();
    expect(renamed.items.map(getSaveJourneyLabel)).toEqual(['风02', '风01', '风02']);
    expect(renamed.items.find(item => item.id === 1)?.travelerName).toBe('云');
    await seed([summary(4, 'a')]);
    expect((await getSaveCatalogSnapshot()).items.filter(item => item.saveTree?.rootId === 'a').map(getSaveJourneyLabel)).toEqual(['云01', '云01', '云01']);
  });
  it('atomically allocates disjoint full snapshots in independent contexts', async () => {
    const empty = { items: [], legacyBackups: [], pendingIds: [], unreadableIds: [], staleCatalogIds: [], hiddenBaseCount: 0, totalStoredCount: 0, catalogComplete: true };
    vi.resetModules(); const a = await import('@/services/storage/saveJourneyRegistry');
    vi.resetModules(); const b = await import('@/services/storage/saveJourneyRegistry');
    const [one, two] = await Promise.all([a.attachSaveJourneyLabels({ ...empty, items: [summary(1, 'a')] }), b.attachSaveJourneyLabels({ ...empty, items: [summary(2, 'b')] })]);
    expect(new Set([...ordinals(one.items), ...ordinals(two.items)])).toEqual(new Set([1, 2]));
  });
  it.each([undefined, null, {}, { version: 1, roots: [{ identity: 'a', allocations: [{ name: '云', ordinal: 2 }] }], counters: [{ name: '云', lastOrdinal: 1 }] }])('fails closed for a corrupt registry: %j', async value => {
    await seed([summary(1, 'a')]); const db = await openGameDatabase();
    await new Promise<void>(resolve => { const tx = db.transaction(SETTINGS_STORE, 'readwrite'); tx.objectStore(SETTINGS_STORE).put({ key: SAVE_JOURNEY_REGISTRY_KEY, value }); tx.oncomplete = () => resolve(); });
    await expect(getSaveCatalogSnapshot()).rejects.toThrow(/注册表损坏/);
  });
  it('does not persist on every view and rejects failed allocation writes without returning a reusable ordinal', async () => {
    await seed([summary(1, 'a')]); await getSaveCatalogSnapshot();
    const original = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    try {
      await getSaveCatalogSnapshot(); expect(put).not.toHaveBeenCalled();
      put.mockImplementation(function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
        if (this.name === SETTINGS_STORE) throw new DOMException('full', 'QuotaExceededError');
        return original.apply(this, args);
      });
      await seed([summary(2, 'b')]); await expect(getSaveCatalogSnapshot()).rejects.toThrow('full');
    } finally { put.mockRestore(); }
    expect((await getSaveCatalogSnapshot()).items.map(getSaveJourneyLabel)).toEqual(['云02', '云01']);
  });
  it('preserves explicit root branches', () => {
    const a = summary(1, 'a'); const b = { ...summary(2, 'a'), saveTree: { ...summary(2, 'a').saveTree!, parentNodeId: 'node-1' } };
    const c = { ...summary(3, 'a'), saveTree: { ...summary(3, 'a').saveTree!, parentNodeId: 'node-1' } };
    const group = buildSaveTreeGroups([a, b, c])[0]!;
    expect(group.branchCount).toBe(1); expect(group.nodes.map(node => node.depth)).toEqual([1, 1, 0]);
  });
  it('never rotates away actual saves whose game round had to be inferred', async () => {
    for (let i = 0; i < 12; i++) {
      const game = createEmptyTeyvatGameState();
      await saveGame({ ...game, turnCount: undefined, type: 'auto', timestamp: i + 1,
        saveTree: { rootId: 'unproven', nodeId: `unproven-${i}`, createdAt: i + 1 } } as never);
    }
    const catalog = await getSaveCatalogSnapshot();
    expect(catalog.items).toHaveLength(12); expect(catalog.items.every(item => item.turnCountSource === 'inferred')).toBe(true);
    for (const item of catalog.items) expect(await loadSave(item.id)).not.toBeNull();
  });
  it('rotates real IndexedDB saves to ten rounds with intact hidden bases, all branches and two independent same-name roots', async () => {
    const saved: Array<{ id: number; turn: number }> = [];
    for (const rootId of ['round-root-a', 'round-root-b']) {
      for (let turn = 0; turn <= 11; turn++) {
        const game = createEmptyTeyvatGameState(); game.旅行者.姓名 = '云'; game.turnCount = turn;
        game.对话.entries = Array.from({ length: turn + 1 }, (_, i) => ({ id: `${rootId}-${i}`, role: 'assistant', content: `完整正文 ${i}`, timestamp: i } as never));
        const id = await saveGame({ ...game, type: 'auto', timestamp: turn + 1, saveTree: { rootId, nodeId: `${rootId}-${turn}`, parentNodeId: turn ? `${rootId}-${turn - 1}` : undefined, createdAt: turn + 1 } } as never);
        if (turn >= 2) saved.push({ id, turn });
      }
      const latest = await loadSave(saved[saved.length - 1]!.id);
      const id = await saveGame({ ...latest, id: 0, timestamp: 100, saveTree: { rootId, nodeId: `${rootId}-branch`, parentNodeId: `${rootId}-10`, createdAt: 100 } } as never);
      saved.push({ id, turn: 11 });
    }
    const catalog = await getSaveCatalogSnapshot();
    expect(catalog.items).toHaveLength(22); expect(catalog.hiddenBaseCount).toBeGreaterThan(0);
    for (const rootId of ['round-root-a', 'round-root-b']) {
      const items = catalog.items.filter(item => item.saveTree?.rootId === rootId);
      expect(new Set(items.map(item => item.turnCount)).size).toBe(10);
      expect(items.filter(item => item.turnCount === 11)).toHaveLength(2);
      expect(new Set(items.map(getSaveJourneyLabel)).size).toBe(1);
    }
    expect(new Set(catalog.items.map(getSaveJourneyLabel)).size).toBe(2);
    for (const item of saved) {
      const loaded = await loadSave(item.id) as unknown as ReturnType<typeof createEmptyTeyvatGameState>;
      expect(loaded.turnCount).toBe(item.turn); expect(loaded.对话.entries).toHaveLength(item.turn + 1);
      expect(loaded.旅行者.姓名).toBe('云');
    }
  });
});
