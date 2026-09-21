import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 跨进程存档 id 预留的 CAS 语义。
 *
 * 数据丢失级竞态：两个应用实例同时预留 id 时，双方各自 `max(index, sequence) + 1`
 * 会算出**同一个** id，后写的一方直接覆盖前者的存档。
 * 这里锁定修复后的契约：认领必须走排他创建，且认领标记是持久墓碑。
 */

const storage = vi.hoisted(() => {
  const records = new Map<string, unknown>();
  const exclusiveImpl = async (path: string, content: unknown) => {
    if (records.has(path)) return false;
    records.set(path, content);
    return true;
  };
  return {
    records,
    exclusiveImpl,
    readText: vi.fn(async (path: string) => (records.has(path) ? String(records.get(path)) : null)),
    writeText: vi.fn(async (path: string, content: unknown) => { records.set(path, content); }),
    writeTextExclusive: vi.fn(exclusiveImpl),
    readJson: vi.fn(async (path: string) => records.get(path) ?? null),
    writeJson: vi.fn(async (path: string, value: unknown) => { records.set(path, value); }),
    remove: vi.fn(async (path: string) => { records.delete(path); }),
    list: vi.fn(async () => [] as string[]),
  };
});

vi.mock('../../utils/platform/desktopRuntime', () => ({ isDesktopRuntime: () => true }));
vi.mock('../../services/storage/appStorageAdapter', () => ({
  createAppStorageAdapter: () => storage,
}));

import { reserveDesktopSaveId } from '../../services/desktop/desktopSaveMirror';

const SEQUENCE_PATH = 'saves/sequence.json';
const claimPath = (id: number) => `claims/save-id-${id}`;

const readSequence = () => storage.records.get(SEQUENCE_PATH) as { lastSaveId?: number } | undefined;

describe('desktop save id reservation (cross-process CAS)', () => {
  beforeEach(() => {
    storage.records.clear();
    vi.clearAllMocks();
    storage.writeTextExclusive.mockImplementation(storage.exclusiveImpl);
  });

  it('reserves the next id through an exclusive claim and advances the sequence', async () => {
    await expect(reserveDesktopSaveId()).resolves.toBe(1);

    expect(storage.writeTextExclusive).toHaveBeenCalledWith(claimPath(1), expect.anything());
    expect(readSequence()?.lastSaveId).toBe(1);
  });

  it('keeps the claim as a durable tombstone so a stale reader cannot re-take the id', async () => {
    // 模拟另一个实例：它在我们写序列**之前**就读完了 index/sequence（因此它的 candidate 仍是 1），
    // 但直到我们返回之后才轮到它调用 create_new。墓碑必须仍在，否则它会认领同一个 1 号。
    storage.records.set(claimPath(1), '1');

    await expect(reserveDesktopSaveId()).resolves.toBe(2);

    expect(storage.records.has(claimPath(1))).toBe(true);
    expect(storage.records.has(claimPath(2))).toBe(true);
    expect(readSequence()?.lastSaveId).toBe(2);
    // 认领成功的标记不允许被删除——删掉就等于把竞态窗口重新打开。
    expect(storage.remove).not.toHaveBeenCalledWith(claimPath(2));
  });

  it('never reuses a tombstoned id even when the sequence is missing', async () => {
    storage.records.set(claimPath(1), '1');
    storage.records.set(claimPath(2), '2');

    await expect(reserveDesktopSaveId()).resolves.toBe(3);
    expect(readSequence()?.lastSaveId).toBe(3);
  });

  it('honours the caller minimum id and skips past tombstones above it', async () => {
    storage.records.set(claimPath(10), '10');

    await expect(reserveDesktopSaveId(10)).resolves.toBe(11);
    expect(readSequence()?.lastSaveId).toBe(11);
  });

  it('returns null instead of an id that might collide when every candidate is taken', async () => {
    storage.writeTextExclusive.mockImplementation(async () => false);

    await expect(reserveDesktopSaveId()).resolves.toBeNull();

    // 放弃时不得写序列，否则会把序列推进到一个没有存档的 id 上。
    expect(storage.writeJson).not.toHaveBeenCalledWith(SEQUENCE_PATH, expect.anything());
  });
});
