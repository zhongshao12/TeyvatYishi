import { describe, expect, it } from 'vitest';
import * as saveCatalog from '@/services/storage/saveCatalog';
import type { SaveCatalogSnapshot } from '@/services/storage/saveCatalog';

const snapshot = (totalStoredCount: number): SaveCatalogSnapshot => ({
  items: [],
  legacyBackups: [],
  pendingIds: [],
  unreadableIds: [],
  staleCatalogIds: [],
  hiddenBaseCount: 0,
  totalStoredCount,
  catalogComplete: true,
});

describe('save failure visibility and catalog fallback', () => {
  it('retains pending saves from either backend instead of selecting a catalog by total count', () => {
    const select = Reflect.get(saveCatalog, 'selectPreferredSaveCatalogSnapshot') as undefined | ((desktop: SaveCatalogSnapshot, indexed: SaveCatalogSnapshot) => SaveCatalogSnapshot);
    expect(select).toBeTypeOf('function');
    const desktop = { ...snapshot(1), pendingIds: [10], storedIds: [10], catalogComplete: false };
    const indexed = { ...snapshot(3), pendingIds: [1, 2, 3], storedIds: [1, 2, 3], catalogComplete: false };
    expect(select?.(desktop, indexed).pendingIds).toEqual([10, 3, 2, 1]);
    expect(select?.(desktop, indexed).totalStoredCount).toBe(4);
  });

  it('shows the real save error and gives quota exhaustion a clear explanation', () => {
    const format = Reflect.get(saveCatalog, 'formatStorageOperationError') as undefined | ((action: string, error: unknown) => string);
    expect(format).toBeTypeOf('function');
    expect(format?.('保存', new Error('存档格式无效'))).toBe('保存失败：存档格式无效');
    expect(format?.('保存', { name: 'QuotaExceededError', message: 'quota reached' })).toContain('存储空间不足');
  });
});
