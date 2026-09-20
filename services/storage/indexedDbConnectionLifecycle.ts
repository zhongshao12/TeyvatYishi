/**
 * Give cached IndexedDB connections the same invalidation policy.
 * `close` is emitted for abnormal connection loss; `versionchange` must close
 * voluntarily so another tab can upgrade the database.
 */
export function bindIndexedDbConnectionLifecycle(
  db: IDBDatabase,
  invalidate: () => void,
): void {
  db.onclose = () => invalidate();
  db.onversionchange = () => {
    db.close();
    invalidate();
  };
}
