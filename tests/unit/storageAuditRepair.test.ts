import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import type { 存档数据 } from '@/models/settings';
import { buildDeltaOnlyStoredSave, buildSaveNodeDeltaRecord, canStoreSaveAsDelta, restoreSaveFromDelta } from '@/utils/saveDeltaStorage';
import { buildSaveCatalogSnapshot, createCatalogRecordFromSummary, createHiddenDeltaBaseCatalogRecord, selectPreferredSaveCatalogSnapshot } from '@/services/storage/saveCatalog';

const disk = vi.hoisted(() => {
  const files = new Map<string, string>();
  return {
    files,
    readJson: async (path: string) => files.has(path) ? JSON.parse(files.get(path)!) : null,
    writeJson: async (path: string, value: unknown) => { files.set(path, JSON.stringify(value)); },
    readText: async (path: string) => files.get(path) ?? null,
    writeText: async (path: string, value: string) => { files.set(path, value); },
    writeTextExclusive: async (path: string, value: string) => { if (files.has(path)) return false; files.set(path, value); return true; },
    readBase64File: async (path: string) => files.get(path) ?? null,
    writeBase64File: async (path: string, value: string) => { files.set(path, value); },
    remove: async (path: string) => { files.delete(path); },
    list: async (prefix: string) => [...files.keys()].filter(path => path.startsWith(`${prefix}/`)).map(path => path.slice(prefix.length + 1)),
  };
});
vi.mock('@/utils/platform/desktopRuntime', () => ({ isDesktopRuntime: () => true }));
vi.mock('@/services/storage/appStorageAdapter', () => ({ createAppStorageAdapter: () => disk }));
import { mirrorSaveToDesktop, hideSaveInDesktopMirror } from '@/services/desktop/desktopSaveMirror';
import { mirrorSaveNodeDeltaToDesktop } from '@/services/desktop/desktopSaveDeltaMirror';
import { loadDesktopAssetRecords, mirrorAssetRecordsToDesktop, repairDesktopAssetMirrorIndex } from '@/services/desktop/desktopAssetMirror';
import { backupCurrentSavesToDesktop, cleanupUnreferencedDesktopAssets, getSaveCatalogSnapshot, loadSave, loadSaveForCloudTransfer, rebuildIndexedSaveCacheFromDesktopMirror, replaceAllSaves, restoreSavesFromDesktopBackup, saveGame } from '@/services/dbService';
import { openGameDatabase, SAVES_STORE, SAVE_SUMMARIES_STORE, SAVE_NODE_DELTAS_STORE, SAVE_ASSETS_STORE } from '@/services/storage/gameDatabase';
import { withDesktopStorageLock } from '@/services/desktop/desktopStorageLock';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function save(id: number, entries: unknown[] = []) {
  const game = createEmptyTeyvatGameState();
  game.旅行者.姓名 = `旅人 ${id}`;
  return { ...game, id, type: id === 1 ? 'manual' : 'auto', timestamp: id, 对话: { entries }, saveTree: { rootId: 'root', nodeId: `node-${id}`, ...(id > 1 ? { parentNodeId: 'node-1' } : {}) } } as unknown as 存档数据;
}
function summary(id: number) {
  return { id, universe: 'teyvat', schemaVersion: 2, type: 'auto', timestamp: id, travelerName: '', turnCount: 1, worldPeriodName: '', currentDate: '', currentTime: '', currentLocation: '', lastSummary: '', sizeBytes: 1 } as const;
}
const message = (id: string, content: string) => ({ id, role: 'assistant', content, timestamp: 1 });
async function seedDelta(withImage = false) {
  const base = save(1, [message('a', '基线')]);
  const next = save(2, [message('a', '基线'), message('b', '新消息')]);
  if (withImage) {
    next.相册 = { ...next.相册!, assets: [{ id: 'delta-picture', dataUrl: 'asset:delta-picture', createdAt: 1 } as never] };
    await mirrorAssetRecordsToDesktop([{ id: 'delta-picture', dataUrl: 'data:image/png;base64,aGVsbG8=', updatedAt: 1 }]);
  }
  await mirrorSaveToDesktop(base, summary(1));
  await mirrorSaveNodeDeltaToDesktop(buildSaveNodeDeltaRecord(base, 1));
  await mirrorSaveToDesktop(next, summary(2), { deltaPrimaryBaseSaveId: 1 });
  await mirrorSaveNodeDeltaToDesktop(buildSaveNodeDeltaRecord(next, 2, { baseSave: base, baseSaveId: 1, storageMode: 'delta' }));
  return { base, next };
}
async function indexedIds() {
  const db = await openGameDatabase();
  return new Promise<IDBValidKey[]>((resolve, reject) => {
    const req = db.transaction(SAVES_STORE).objectStore(SAVES_STORE).getAllKeys();
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
beforeEach(async () => {
  disk.files.clear();
  const db = await openGameDatabase();
  await new Promise<void>((resolve, reject) => {
    const stores = [SAVES_STORE, SAVE_SUMMARIES_STORE, SAVE_NODE_DELTAS_STORE, SAVE_ASSETS_STORE];
    const tx = db.transaction(stores, 'readwrite');
    stores.forEach(name => tx.objectStore(name).clear());
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
});

describe('storage audit contracts S01–S07', () => {
  it('reads metadata fallback without silently rewriting the shared asset index', async () => {
    await seedDelta(true); disk.files.delete('assets/index.json');
    expect(await loadDesktopAssetRecords(['delta-picture'])).toMatchObject([{ id: 'delta-picture' }]);
    expect(disk.files.has('assets/index.json')).toBe(false);
  });
  it.each(['load', 'cloud export'])('keeps %s on one baseline while another instance overwrites it', async mode => {
    const { base } = await seedDelta();
    vi.resetModules(); const other = await import('@/services/dbService');
    let reached!: () => void, release!: () => void, contended!: () => void;
    const ready = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const contention = new Promise<void>(resolve => { contended = resolve; });
    let first = true;
    const read = disk.readJson, exclusive = disk.writeTextExclusive;
    const readSpy = vi.spyOn(disk, 'readJson').mockImplementation(async path => {
      const value = await read(path);
      if (first && path === 'saves/deltas/delta-node-2.json') { first = false; reached(); await gate; }
      return value;
    });
    const lockSpy = vi.spyOn(disk, 'writeTextExclusive').mockImplementation(async (path, value) => {
      const ok = await exclusive(path, value); if (path === 'locks/save-mutations.lock' && !ok) contended(); return ok;
    });
    const reading = mode === 'load' ? loadSave(2) : loadSaveForCloudTransfer(2).then(bundle => bundle?.save ?? null);
    let writing: Promise<number> | undefined;
    try {
      await ready;
      writing = other.saveGame({ ...base, 世界: { ...(base as unknown as ReturnType<typeof createEmptyTeyvatGameState>).世界, 当前地点: '替换后的地点' } } as never, { overwriteManualId: 1 });
      await Promise.race([writing.then(() => undefined), contention]); release();
      const loaded = await reading; await writing;
      expect(loaded).toMatchObject({ 旅行者: { 姓名: '旅人 2' } });
      expect(loaded).toMatchObject({ 世界: { 当前地点: '' } });
    } finally {
      release(); await Promise.allSettled([reading, ...(writing ? [writing] : [])]);
      readSpy.mockRestore(); lockSpy.mockRestore();
    }
  });

  it.each(['rebuild', 'asset cleanup', 'asset index repair'])('does not lose a concurrent save during %s maintenance', async mode => {
    await seedDelta(true);
    vi.resetModules(); const other = await import('@/services/dbService');
    let reached!: () => void, release!: () => void, contended!: () => void;
    const ready = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const contention = new Promise<void>(resolve => { contended = resolve; });
    const path = mode === 'rebuild' ? 'saves/deltas/index.json' : 'assets/index.json';
    const read = disk.readJson, exclusive = disk.writeTextExclusive, list = disk.list;
    let first = true;
    const readSpy = vi.spyOn(disk, 'readJson').mockImplementation(async name => {
      if (first && mode !== 'asset index repair' && name === path) { first = false; reached(); await gate; }
      return read(name);
    });
    const listSpy = vi.spyOn(disk, 'list').mockImplementation(async prefix => {
      const result = await list(prefix);
      if (first && mode === 'asset index repair' && prefix === 'assets/generated-images') { first = false; reached(); await gate; }
      return result;
    });
    const lockSpy = vi.spyOn(disk, 'writeTextExclusive').mockImplementation(async (name, value) => {
      const ok = await exclusive(name, value); if (name === 'locks/save-mutations.lock' && !ok) contended(); return ok;
    });
    const maintenance = mode === 'rebuild' ? rebuildIndexedSaveCacheFromDesktopMirror()
      : mode === 'asset index repair' ? repairDesktopAssetMirrorIndex() : cleanupUnreferencedDesktopAssets();
    const added = save(0); added.type = 'manual';
    (added as unknown as { saveTree: unknown }).saveTree = { rootId: 'concurrent-root', nodeId: 'concurrent-node' };
    added.相册 = { ...added.相册!, assets: [{ id: 'concurrent-image', dataUrl: 'data:image/png;base64,aGVsbG8=', createdAt: 1 } as never] };
    let writing: Promise<number> | undefined;
    try {
      await ready; writing = other.saveGame(added);
      await Promise.race([writing.then(() => undefined), contention]); release();
      await maintenance; const id = await writing;
      expect(await loadSave(id)).toMatchObject({ 旅行者: { 姓名: '旅人 0' } });
      expect((await loadSaveForCloudTransfer(id))?.assetRecords).toMatchObject([{ id: 'concurrent-image' }]);
      expect(JSON.parse(disk.files.get('assets/index.json')!).assets).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'concurrent-image' })]));
    } finally {
      release(); await Promise.allSettled([maintenance, ...(writing ? [writing] : [])]);
      readSpy.mockRestore(); lockSpy.mockRestore(); listSpy.mockRestore();
    }
  });
  it('S04 restores formal dialogue after a real JSON placeholder round trip', () => {
    const base = save(1, [message('a', '旧')]); const next = save(2, [message('a', '旧'), message('b', '新')]);
    const delta = buildSaveNodeDeltaRecord(next, 2, { baseSave: base, baseSaveId: 1, storageMode: 'delta' })!;
    const restored = restoreSaveFromDelta(json(base), json(buildDeltaOnlyStoredSave(next, 1)), json(delta));
    expect((restored as unknown as { 对话: { entries: unknown[] } }).对话.entries).toEqual([message('a', '旧'), message('b', '新')]);
    expect(restored).not.toHaveProperty('chatHistory');
  });
  it('S05 keeps same-ID body edits and added narrative images rather than treating them as an unchanged prefix', () => {
    const base = save(1, [message('a', '旧正文')]);
    const next = save(2, [{ ...message('a', '已编辑'), narrativeImages: [{ id: 'image-1' }] }]);
    expect(canStoreSaveAsDelta(next, base)).toBe(false);
    expect(buildSaveNodeDeltaRecord(next, 2, { baseSave: base, baseSaveId: 1, storageMode: 'delta' })!.baseMode).toBe('checkpoint');
  });
  it('S01 loads and cloud-exports a complete desktop-only delta node and its image', async () => {
    await seedDelta(true);
    const loaded = await loadSave(2);
    expect(loaded).toMatchObject({ 旅行者: { 姓名: '旅人 2' }, 对话: { entries: [message('a', '基线'), message('b', '新消息')] } });
    const bundle = await loadSaveForCloudTransfer(2);
    expect(bundle?.save).toMatchObject({ 旅行者: { 姓名: '旅人 2' } });
    expect(bundle?.assetRecords).toMatchObject([{ id: 'delta-picture', dataUrl: 'data:image/png;base64,aGVsbG8=' }]);
  });
  it('S02 rebuilds from materialized desktop nodes without deleting the only delta/image payload', async () => {
    await seedDelta(true);
    expect(await rebuildIndexedSaveCacheFromDesktopMirror()).toBe(2);
    expect(await loadSave(2)).toMatchObject({ 旅行者: { 姓名: '旅人 2' }, 对话: { entries: [message('a', '基线'), message('b', '新消息')] } });
    expect((await loadSaveForCloudTransfer(2))?.assetRecords).toHaveLength(1);
  });
  it('S02 rebuilds hidden baselines while keeping their dependent nodes visible', async () => {
    await seedDelta(true); await hideSaveInDesktopMirror(1);
    expect(await rebuildIndexedSaveCacheFromDesktopMirror()).toBe(2);
    const catalog = await getSaveCatalogSnapshot();
    expect(catalog.items.map(item => item.id)).toEqual([2]);
    expect(catalog.hiddenBaseCount).toBe(1);
    expect((await loadSaveForCloudTransfer(2))?.assetRecords).toHaveLength(1);
  });
  it.each(['missing delta', 'missing base', 'unreadable save'])('S02 rejects %s before touching any live data', async failure => {
    await seedDelta(true);
    if (failure === 'missing delta') disk.files.delete('saves/deltas/delta-node-2.json');
    if (failure === 'missing base') disk.files.delete('saves/save-1.json');
    if (failure === 'unreadable save') disk.files.set('saves/save-1.json', '{broken');
    const before = [...disk.files]; const beforeIds = await indexedIds();
    await expect(rebuildIndexedSaveCacheFromDesktopMirror()).rejects.toThrow();
    expect([...disk.files]).toEqual(before); expect(await indexedIds()).toEqual(beforeIds);
  });
  it('S02 refuses unresolved placeholders passed directly to replaceAllSaves', async () => {
    const live = await saveGame(save(0)); const before = [...disk.files];
    await expect(replaceAllSaves([buildDeltaOnlyStoredSave(save(2), 404)], { skipDesktopBackup: true })).rejects.toThrow();
    expect(await indexedIds()).toEqual([live]); expect([...disk.files]).toEqual(before);
  });
  it('S02 rejects read-only legacy replacement before clearing existing stores', async () => {
    const live = await saveGame(save(0)); const before = [...disk.files];
    await expect(replaceAllSaves([{ id: 100, universe: 'legacy-hsr', schemaVersion: 1 } as never], { skipDesktopBackup: true })).rejects.toThrow('LEGACY_HSR_SAVE_READ_ONLY');
    expect(await indexedIds()).toEqual([live]); expect([...disk.files]).toEqual(before);
  });
  it('S02 backup is self-contained and still restores after all live mirrors are gone', async () => {
    await seedDelta(true);
    const backup = await backupCurrentSavesToDesktop();
    const raw = JSON.parse(disk.files.get(backup!.path)!);
    expect(raw.saves[1].旅行者.姓名).toBe('旅人 2');
    expect(raw.saves[1].相册.assets[0].dataUrl).toBe('data:image/png;base64,aGVsbG8=');
    for (const path of [...disk.files.keys()]) if (!path.startsWith('backups/')) disk.files.delete(path);
    expect(await restoreSavesFromDesktopBackup(backup!.path)).toBe(2);
    expect((await loadSaveForCloudTransfer(2))?.assetRecords).toMatchObject([{ id: 'delta-picture', dataUrl: 'data:image/png;base64,aGVsbG8=' }]);
  });
  it('S03 keeps images referenced only by a delta node', async () => {
    await seedDelta(true);
    await cleanupUnreferencedDesktopAssets();
    expect((await loadSaveForCloudTransfer(2))?.assetRecords).toHaveLength(1);
  });
  it('S03 keeps images in a hidden checkpoint even when no visible node currently references them', async () => {
    const base = save(1); base.相册 = { ...base.相册!, assets: [{ id: 'hidden-picture', dataUrl: 'asset:hidden-picture', createdAt: 1 } as never] };
    await mirrorAssetRecordsToDesktop([{ id: 'hidden-picture', dataUrl: 'data:image/png;base64,aGVsbG8=', updatedAt: 1 }]);
    await mirrorSaveToDesktop(base, summary(1)); await hideSaveInDesktopMirror(1);
    const result = await cleanupUnreferencedDesktopAssets();
    expect(result.totalAssets).toBe(1);
    expect(disk.files.get('assets/generated-images/hidden-picture.png')).toBe('aGVsbG8=');
  });
  it('S03 fails closed on a missing delta dependency, leaving every asset file untouched', async () => {
    await seedDelta(true); disk.files.delete('saves/deltas/delta-node-2.json');
    const before = [...disk.files];
    await expect(cleanupUnreferencedDesktopAssets()).rejects.toThrow();
    expect([...disk.files]).toEqual(before);
  });
  it('S06 unions exclusive desktop and indexed nodes, preferring desktop for conflicting IDs', () => {
    const desktop = buildSaveCatalogSnapshot([createCatalogRecordFromSummary(summary(10)), createCatalogRecordFromSummary({ ...summary(2), travelerName: 'desktop' })], [10, 2]);
    const indexed = buildSaveCatalogSnapshot([createCatalogRecordFromSummary(summary(1)), createCatalogRecordFromSummary(summary(2)), createHiddenDeltaBaseCatalogRecord({ ...summary(3) })], [1, 2, 3]);
    const result = selectPreferredSaveCatalogSnapshot(desktop, indexed);
    expect(result.items.map(item => item.id)).toEqual([10, 2, 1]);
    expect(result.items.find(item => item.id === 2)?.travelerName).toBe('desktop');
    expect(result.hiddenBaseCount).toBe(1); expect(result.totalStoredCount).toBe(4);
  });
  it('S06 counts desktop-only hidden checkpoints without displaying them', async () => {
    await mirrorSaveToDesktop(save(1), summary(1)); await hideSaveInDesktopMirror(1);
    const catalog = await getSaveCatalogSnapshot();
    expect(catalog.items).toEqual([]); expect(catalog.hiddenBaseCount).toBe(1); expect(catalog.totalStoredCount).toBe(1);
  });
  it('S01 rejects a missing dependency instead of returning a playable placeholder', async () => {
    await seedDelta(); disk.files.delete('saves/deltas/delta-node-2.json');
    await expect(loadSave(2)).rejects.toThrow(); await expect(loadSaveForCloudTransfer(2)).rejects.toThrow();
  });
  it('S01 rejects JSON delta payloads missing their chat boundary instead of truncating the baseline', async () => {
    await seedDelta();
    const path = 'saves/deltas/delta-node-2.json'; const record = JSON.parse(disk.files.get(path)!);
    delete record.delta.deltaPayload.chatBaseLength; disk.files.set(path, JSON.stringify(record));
    await expect(loadSave(2)).rejects.toThrow();
  });
  it('S02 rejects a structurally incomplete checkpoint before replacing live stores', async () => {
    await seedDelta();
    const path = 'saves/save-1.json'; const record = JSON.parse(disk.files.get(path)!);
    delete record.save.旅行者; disk.files.set(path, JSON.stringify(record)); const before = [...disk.files];
    await expect(rebuildIndexedSaveCacheFromDesktopMirror()).rejects.toThrow();
    expect([...disk.files]).toEqual(before); expect(await indexedIds()).toEqual([]);
  });
  it('S01 preserves asset payloads available only in IDB when the node itself is desktop-primary', async () => {
    await seedDelta(true);
    const db = await openGameDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SAVE_ASSETS_STORE, 'readwrite');
      tx.objectStore(SAVE_ASSETS_STORE).put({ id: 'delta-picture', dataUrl: 'data:image/png;base64,aGVsbG8=', updatedAt: 1 });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    for (const path of [...disk.files.keys()]) if (path.startsWith('assets/')) disk.files.delete(path);
    expect((await loadSaveForCloudTransfer(2))?.assetRecords).toMatchObject([{ id: 'delta-picture', dataUrl: 'data:image/png;base64,aGVsbG8=' }]);
  });
  it('S07 keeps both index entries when independent module instances mirror concurrently', async () => {
    vi.resetModules(); const instanceA = await import('@/services/desktop/desktopSaveMirror');
    vi.resetModules(); const instanceB = await import('@/services/desktop/desktopSaveMirror');
    await Promise.all([instanceA.mirrorSaveToDesktop(save(1), summary(1)), instanceB.mirrorSaveToDesktop(save(2), summary(2))]);
    expect(JSON.parse(disk.files.get('saves/index.json')!).saves.map((item: { id: number }) => item.id).sort()).toEqual([1, 2]);
  });
  it('S07 also keeps concurrently written delta index entries', async () => {
    const a = buildSaveNodeDeltaRecord(save(1), 1)!; const b = buildSaveNodeDeltaRecord(save(2), 2)!;
    await Promise.all([mirrorSaveNodeDeltaToDesktop(a), mirrorSaveNodeDeltaToDesktop(b)]);
    expect(JSON.parse(disk.files.get('saves/deltas/index.json')!).deltas.map((item: { saveId: number }) => item.saveId).sort()).toEqual([1, 2]);
  });
  it('S07 releases its lock after an operation fails, so another instance can retry safely', async () => {
    await expect(withDesktopStorageLock('test-index', async () => { throw new Error('write failed'); })).rejects.toThrow('write failed');
    expect(await withDesktopStorageLock('test-index', async () => 'retry complete')).toBe('retry complete');
    expect(disk.files.has('locks/test-index.lock')).toBe(false);
  });
  it('S07 times out without stealing an existing lock or running the write', async () => {
    disk.files.set('locks/test-index.lock', 'other instance');
    let mutated = false;
    vi.useFakeTimers();
    try {
      const outcome = expect(withDesktopStorageLock('test-index', async () => { mutated = true; })).rejects.toThrow(/锁/);
      await vi.runAllTimersAsync(); await outcome;
      expect(mutated).toBe(false); expect(disk.files.get('locks/test-index.lock')).toBe('other instance');
    } finally { vi.useRealTimers(); }
  });
});
