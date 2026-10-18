import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readExistingCore2Setting } from '@/core/view/existingSettings';
import { createCore2DevelopmentSeed } from '@/core/view/developmentSeed';
import { validateCoreDto } from '@/core/contracts/validation';

it('does not create a legacy database just to look for reusable settings', async () => {
  const factory = new IDBFactory();
  expect(await readExistingCore2Setting('gameSettings', factory)).toBeNull();
  expect(await factory.databases()).toEqual([]);
});
it('reads existing settings without upgrading or touching any save store', async () => {
  const factory = new IDBFactory();
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = factory.open('TimeJourneyDB', 1); request.onupgradeneeded = () => { request.result.createObjectStore('settings', { keyPath: 'key' }); request.result.createObjectStore('untouched'); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  await new Promise<void>((resolve, reject) => { const tx = db.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ key: 'gameSettings', value: { name: 'selected preset' } }); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
  db.close();
  expect(await readExistingCore2Setting('gameSettings', factory)).toEqual({ name: 'selected preset' });
  expect((await factory.databases())[0]?.version).toBe(1);
});
it('creates a valid independent development seed, even for two identical player names', () => {
  const a = createCore2DevelopmentSeed('云'), b = createCore2DevelopmentSeed('云');
  for (const record of a.records) expect(validateCoreDto('state', record).ok, record.domain).toBe(true);
  expect(validateCoreDto('seed', a).ok).toBe(true);
  expect(a.head.scope.journeyId).not.toBe(b.head.scope.journeyId);
  expect(a.playerId).not.toBe(b.playerId);
});
