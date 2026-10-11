import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import { saveGame } from '@/services/dbService';
import { openGameDatabase, SETTINGS_STORE } from '@/services/storage/gameDatabase';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('fails closed on a shared browser mutation lock rather than stealing it by age', async () => {
  vi.stubGlobal('navigator', {});
  const db = await openGameDatabase();
  const key = 'internal.saveMutationLock.v1';
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    tx.objectStore(SETTINGS_STORE).put({ key, value: { owner: 'another-tab', startedAt: 0 } });
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  const game = createEmptyTeyvatGameState();
  try {
    await expect(saveGame(game)).rejects.toThrow('存档正由另一页面更新');
    const stored = await new Promise<{ value: { owner: string } }>(resolve => {
      const request = db.transaction(SETTINGS_STORE).objectStore(SETTINGS_STORE).get(key);
      request.onsuccess = () => resolve(request.result);
    });
    expect(stored.value.owner).toBe('another-tab');
  } finally {
    await new Promise<void>(resolve => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite'); tx.objectStore(SETTINGS_STORE).delete(key);
      tx.oncomplete = () => resolve();
    });
  }
}, 7000);
