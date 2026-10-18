import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { openCoreDatabase, CORE2_STORES } from '@/core/persistence/indexedSchema';

describe('core2 IndexedDB namespace and layout', () => {
  it('creates a separate database without opening or upgrading the legacy database', async () => {
    const factory = new IDBFactory();
    const db = await openCoreDatabase('TeyvatCore2DB', factory);
    expect(db.name).toBe('TeyvatCore2DB');
    expect(db.version).toBe(1);
    expect((await factory.databases()).map(item => item.name)).toEqual(['TeyvatCore2DB']);
    expect(db.objectStoreNames.contains('settings')).toBe(false);
    expect(db.objectStoreNames.contains('events')).toBe(true);
    expect(db.objectStoreNames.contains('sources')).toBe(true);
    expect(db.objectStoreNames.contains('operations')).toBe(true);
    db.close();
  });

  it('refuses the legacy database name before issuing an open request', async () => {
    const factory = new IDBFactory();
    await expect(openCoreDatabase('TimeJourneyDB', factory)).rejects.toThrow('CORE2_LEGACY_DATABASE_FORBIDDEN');
    expect(await factory.databases()).toEqual([]);
  });

  it('keeps sources, current state, effects and derived memory in independent stores', async () => {
    const db = await openCoreDatabase('test-core2-schema', new IDBFactory());
    const transaction = db.transaction(['states', 'sources', 'effects', 'memories', 'postings']);
    expect(transaction.objectStore('states').keyPath).toEqual(['scope.journeyId', 'scope.branchId', 'domain', 'entityId']);
    expect(transaction.objectStore('sources').keyPath).toEqual(['record.ref.sourceId', 'record.ref.sourceVersion']);
    expect(transaction.objectStore('effects').keyPath).toEqual(['scope.journeyId', 'scope.branchId', 'effectKey']);
    expect(transaction.objectStore('postings').index('by_key').multiEntry).toBe(false);
    db.close();
  });

  it('allows independent connections without replacing the schema', async () => {
    const factory = new IDBFactory();
    const a = await openCoreDatabase('test-core2-two-connections', factory);
    const b = await openCoreDatabase('test-core2-two-connections', factory);
    expect(a).not.toBe(b);
    expect(a.version).toBe(1);
    expect(b.objectStoreNames.length).toBe(a.objectStoreNames.length);
    a.close();
    b.close();
  });

  it('rejects a same-version database whose store names exist but keys and indexes are wrong', async () => {
    const factory = new IDBFactory(), name = 'test-core2-bad-schema';
    const corrupt = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, 1);
      request.onupgradeneeded = () => { for (const name of CORE2_STORES) request.result.createObjectStore(name, { keyPath: 'wrongKey' }); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    corrupt.close();
    await expect(openCoreDatabase(name, factory)).rejects.toThrow('CORE2_SCHEMA_MISMATCH');
  });
});
