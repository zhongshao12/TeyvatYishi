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
  it('falls back to the IndexedDB catalog when it contains more stored saves', () => {
    const select = Reflect.get(saveCatalog, 'selectPreferredSaveCatalogSnapshot') as undefined | ((desktop: SaveCatalogSnapshot, indexed: SaveCatalogSnapshot) => SaveCatalogSnapshot);
    expect(select).toBeTypeOf('function');
    const desktop = snapshot(1);
    const indexed = snapshot(3);
    expect(select?.(desktop, indexed)).toBe(indexed);
    expect(select?.(snapshot(4), snapshot(3)).totalStoredCount).toBe(4);
  });

  it('shows the real save error and gives quota exhaustion a clear explanation', () => {
    const format = Reflect.get(saveCatalog, 'formatStorageOperationError') as undefined | ((action: string, error: unknown) => string);
    expect(format).toBeTypeOf('function');
    expect(format?.('保存', new Error('存档格式无效'))).toBe('保存失败：存档格式无效');
    expect(format?.('保存', { name: 'QuotaExceededError', message: 'quota reached' })).toContain('存储空间不足');
  });
});
