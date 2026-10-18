import type { CoreStoreName } from './indexedSchema';

export function request<T>(input: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { input.onsuccess = () => resolve(input.result); input.onerror = () => reject(input.error ?? new Error('CORE2_REQUEST_FAILED')); });
}

/** Callbacks await IDB only; persistence is acknowledged by transaction completion. */
export function transact<T>(db: IDBDatabase, stores: CoreStoreName[], mode: IDBTransactionMode, body: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result: T;
    let failure: unknown;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('CORE2_TRANSACTION_ABORTED'));
    body(tx).then(value => { result = value; }, error => {
      failure = error;
      try { tx.abort(); } catch { reject(error); }
    });
  });
}
