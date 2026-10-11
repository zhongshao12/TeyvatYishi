import { withDesktopStorageLock } from '@/services/desktop/desktopStorageLock';
import { isDesktopRuntime } from '@/utils/platform/desktopRuntime';
import { openGameDatabase, SETTINGS_STORE } from './gameDatabase';

const LOCK_KEY = 'internal.saveMutationLock.v1';

/** Covers base selection, dependent materialization and commit as one lifecycle.
 * File/index locks alone cannot protect a mutable checkpoint's delta children. */
export async function withSaveMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  if (isDesktopRuntime()) return withDesktopStorageLock('save-mutations', operation);
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(LOCK_KEY, operation);
  }
  const db = await openGameDatabase();
  const owner = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const deadline = Date.now() + 3000;
  // Older browser fallback: acquire/release by owner in an atomic IDB RMW.
  // Never expire/steal a lock just because a long save has taken more time.
  const changeLock = (release: boolean): Promise<boolean> => new Promise((resolve, reject) => {
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE), request = store.get(LOCK_KEY);
    let acquired = false;
    request.onsuccess = () => {
      if (release) {
        if (request.result?.value?.owner === owner) store.delete(LOCK_KEY);
      } else if (request.result === undefined) {
        store.put({ key: LOCK_KEY, value: { owner } }); acquired = true;
      }
    };
    tx.oncomplete = () => resolve(acquired);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('存档写锁事务已中止'));
  });
  while (!await changeLock(false)) {
    if (Date.now() >= deadline) throw new Error('存档正由另一页面更新，或存在未解除的写锁；已停止写入，请关闭其他页面后重试。');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  try { return await operation(); } finally { await changeLock(true); }
}
