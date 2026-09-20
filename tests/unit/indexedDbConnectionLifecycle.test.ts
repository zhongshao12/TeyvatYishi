import { describe, expect, it, vi } from 'vitest';

describe('IndexedDB connection lifecycle', () => {
  it('invalidates a cached connection after an abnormal close', async () => {
    const module = await import('../../services/storage/indexedDbConnectionLifecycle');
    const db = {
      close: vi.fn(),
      onclose: null,
      onversionchange: null,
    } as unknown as IDBDatabase;
    const invalidate = vi.fn();

    module.bindIndexedDbConnectionLifecycle(db, invalidate);
    db.onclose?.(new Event('close'));

    expect(invalidate).toHaveBeenCalledOnce();
    expect(db.close).not.toHaveBeenCalled();
  });

  it('closes and invalidates a connection when its schema version changes', async () => {
    const module = await import('../../services/storage/indexedDbConnectionLifecycle');
    const db = {
      close: vi.fn(),
      onclose: null,
      onversionchange: null,
    } as unknown as IDBDatabase;
    const invalidate = vi.fn();

    module.bindIndexedDbConnectionLifecycle(db, invalidate);
    db.onversionchange?.(new Event('versionchange') as IDBVersionChangeEvent);

    expect(db.close).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledOnce();
  });
});
