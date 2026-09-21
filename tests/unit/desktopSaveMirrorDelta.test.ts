import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { buildDeltaOnlyStoredSave, buildSaveNodeDeltaRecord, restoreSaveFromDelta } from '@/utils/saveDeltaStorage';

/**
 * C2 的安全网：桌面存档镜像的写入契约。
 *
 * 为什么先写这些测试：`services/desktop/desktopSaveMirror.ts` 此前**没有任何单测或回归**
 * （第二轮审查 §1-S3 的盲区模块之一），而 C2（delta-primary）正是要改它的写入策略 ——
 * 没有这层网，"改完存档读不回"是无法发现的数据丢失。
 *
 * 这里用**假适配器**覆盖：整档写入 / 占位档写入 / **基线不是完整档时必须回退整档**（链深度恒为 1）
 * / 以及"占位档 + base + delta 能还原出与整档一致的数据"。
 */

const storage = vi.hoisted(() => {
  const files = new Map<string, string>();
  return {
    files,
    writeJson: vi.fn(async (path: string, value: unknown) => { files.set(path, JSON.stringify(value)); }),
    readJson: vi.fn(async (path: string) => {
      const raw = files.get(path);
      return raw === undefined ? null : JSON.parse(raw);
    }),
    writeText: vi.fn(async (path: string, content: string) => { files.set(path, String(content)); }),
    readText: vi.fn(async (path: string) => files.get(path) ?? null),
    writeTextExclusive: vi.fn(async (path: string, content: string) => {
      if (files.has(path)) return false;
      files.set(path, String(content));
      return true;
    }),
    readBase64File: vi.fn(async () => null),
    writeBase64File: vi.fn(async (path: string) => { files.set(path, ''); }),
    remove: vi.fn(async (path: string) => { files.delete(path); }),
    list: vi.fn(async (prefix: string) => [...files.keys()]
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))),
  };
});

vi.mock('../../utils/platform/desktopRuntime', () => ({ isDesktopRuntime: () => true }));
vi.mock('../../services/storage/appStorageAdapter', () => ({ createAppStorageAdapter: () => storage }));

import { mirrorSaveToDesktop } from '../../services/desktop/desktopSaveMirror';

const formalSave = (id: number, nodeId: string, parentNodeId?: string) => ({
  ...createEmptyTeyvatGameState(),
  id,
  type: 'auto',
  timestamp: id,
  ...(parentNodeId ? { saveTree: { rootId: 'root-1', nodeId, parentNodeId } } : { saveTree: { rootId: 'root-1', nodeId } }),
}) as never;

const summaryOf = (save: { id?: unknown; timestamp?: unknown }) => ({
  id: Number(save.id) || 0,
  type: 'auto' as const,
  timestamp: Number(save.timestamp) || 0,
  name: `存档 ${save.id}`,
  turnCount: 1,
}) as never;

const readRecord = (id: number) => JSON.parse(storage.files.get(`saves/save-${id}.json`) ?? 'null');
const readIndex = () => JSON.parse(storage.files.get('saves/index.json') ?? 'null');

describe('桌面存档镜像写入契约（C2 安全网）', () => {
  beforeEach(() => {
    storage.files.clear();
    vi.clearAllMocks();
  });

  it('writes the full record, index entry and sequence for a normal save', async () => {
    const save = formalSave(1, 'node-1');
    await mirrorSaveToDesktop(save, summaryOf(save));

    const record = readRecord(1);
    expect(record.save.universe).toBe('teyvat');
    expect(record.summary.storageMode).toBe('full');
    expect(readIndex().saves.map((item: { id: number }) => item.id)).toEqual([1]);
    expect(JSON.parse(storage.files.get('saves/sequence.json') as string).lastSaveId).toBe(1);
  });

  it('writes only a placeholder when the delta base is a full save', async () => {
    const base = formalSave(1, 'node-1');
    await mirrorSaveToDesktop(base, summaryOf(base));
    const next = formalSave(2, 'node-2', 'node-1');

    await mirrorSaveToDesktop(next, summaryOf(next), { deltaPrimaryBaseSaveId: 1 });

    const record = readRecord(2);
    expect(record.summary.storageMode).toBe('delta');
    // 占位形态：正式根字段被清空，只留身份与 saveStorage 标记。
    expect(record.save.saveStorage).toMatchObject({ mode: 'delta', baseSaveId: 1 });
    expect(record.save.对话).toEqual({ entries: [] });
    expect(record.save.背包).toBeUndefined();
    // 索引与序列照常更新 —— 存档仍然"列得出"。
    expect(readIndex().saves.map((item: { id: number }) => item.id).sort()).toEqual([1, 2]);
    expect(JSON.parse(storage.files.get('saves/sequence.json') as string).lastSaveId).toBe(2);
  });

  it('falls back to a full record when the delta base is itself a placeholder', async () => {
    const base = formalSave(1, 'node-1');
    await mirrorSaveToDesktop(base, summaryOf(base));
    const middle = formalSave(2, 'node-2', 'node-1');
    await mirrorSaveToDesktop(middle, summaryOf(middle), { deltaPrimaryBaseSaveId: 1 });
    const latest = formalSave(3, 'node-3', 'node-2');

    // 基线（2 号）是占位档 → 必须写整档，否则会形成"占位的基线也是占位"这种读不回的链。
    await mirrorSaveToDesktop(latest, summaryOf(latest), { deltaPrimaryBaseSaveId: 2 });

    const record = readRecord(3);
    expect(record.summary.storageMode).toBe('full');
    expect(record.save.背包).toBeDefined();
    expect(record.save.saveStorage).toBeUndefined();
  });

  it('falls back to a full record when the delta base is unknown', async () => {
    const save = formalSave(5, 'node-5');

    await mirrorSaveToDesktop(save, summaryOf(save), { deltaPrimaryBaseSaveId: 42 });

    expect(readRecord(5).summary.storageMode).toBe('full');
  });

  it('keeps a placeholder reconstructible from base + delta', async () => {
    const base = formalSave(1, 'node-1');
    const latest = formalSave(2, 'node-2', 'node-1');
    const delta = buildSaveNodeDeltaRecord(latest, 2, { baseSave: base, baseSaveId: 1, storageMode: 'delta' });
    expect(delta).not.toBeNull();

    const placeholder = buildDeltaOnlyStoredSave(latest, 1);
    const restored = restoreSaveFromDelta(base, placeholder, delta!);

    // 还原结果的字段必须与"直接写整档"一致（这里比对关键切片与对话长度）。
    expect(restored.universe).toBe('teyvat');
    expect((restored as unknown as { 背包?: unknown }).背包)
      .toEqual((latest as unknown as { 背包?: unknown }).背包);
    expect((restored as { 对话?: { entries?: unknown[] } }).对话?.entries?.length)
      .toBe((latest as { 对话?: { entries?: unknown[] } }).对话?.entries?.length);
  });

  it('can express every slice the placeholder drops', () => {
    // 覆盖不变量：占位档清空的每个切片，只要相对基线**有变化**，就必须出现在 delta.fields 里
    // （或走 chatHistory）。否则 delta-primary 会写出"占位 + 还原不出"的档 = 丢数据。
    const base = formalSave(1, 'node-1') as unknown as Record<string, unknown>;
    const current = formalSave(2, 'node-2', 'node-1') as unknown as Record<string, unknown>;
    // 让若干切片真的发生变化
    current.世界 = { ...(base.世界 as Record<string, unknown>), 当前地点: '璃月港' };
    current.背包 = { ...(base.背包 as Record<string, unknown>), mora: 4321 };
    current.NPC = [...((base.NPC as unknown[]) ?? []), { id: 'npc_probe', 姓名: '探针角色' }];

    const delta = buildSaveNodeDeltaRecord(current as never, 2, {
      baseSave: base as never, baseSaveId: 1, storageMode: 'delta',
    });
    expect(delta).not.toBeNull();
    const placeholder = buildDeltaOnlyStoredSave(current as never, 1) as unknown as Record<string, unknown>;
    const dropped = Object.keys(placeholder).filter((key) => placeholder[key] === undefined);

    const deltaFields = Object.keys((delta!.deltaPayload?.fields ?? {}) as Record<string, unknown>);
    for (const key of dropped) {
      if (key === '对话') continue;
      const changed = JSON.stringify(current[key]) !== JSON.stringify(base[key]);
      if (!changed) continue;
      expect(deltaFields, `切片 ${key} 被占位档清空且有变化，必须能被 delta 表达`).toContain(key);
    }
    // 三个被主动改动的切片都必须落进 delta。
    expect(deltaFields).toEqual(expect.arrayContaining(['世界', '背包', 'NPC']));
  });
});
