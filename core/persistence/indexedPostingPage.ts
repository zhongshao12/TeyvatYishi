import type { IndexPosting, Page, PostingQuery } from '../contracts/storage';
import { ownDto, scopeKey, stableJson } from './repositoryValidation';
import { request } from './indexedTransaction';

const identity = (row: IndexPosting) => JSON.stringify([row.kind, row.key, row.target, row.targetId]);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Keyed reads keep the existing cursor format/order but materialize only one
 * page plus a lookahead. A common term must not reload its entire posting list
 * for every 50-row page of the same query. */
export async function readKeyedPostingPage(store: IDBObjectStore, query: PostingQuery): Promise<Page<IndexPosting>> {
  const descriptor = Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'cursor'));
  const prefix = `core2-page/${stableJson(descriptor)}/`, limit = query.limit ?? 50;
  const keys = [...new Set(query.keys!)].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  let after: IndexPosting | undefined;
  if (query.cursor) {
    if (!query.cursor.startsWith(prefix)) throw Error('CORE2_CURSOR_MISMATCH');
    const token = query.cursor.slice(prefix.length);
    let tuple: unknown;
    try { tuple = JSON.parse(token); } catch { throw Error('CORE2_CURSOR_STALE'); }
    if (!Array.isArray(tuple) || tuple.length !== 4 || !tuple.every(part => typeof part === 'string')
      || tuple[0] !== query.kind || !keys.includes(tuple[1] as string) || (query.target && tuple[2] !== query.target)) throw Error('CORE2_CURSOR_STALE');
    const saved = await request<IndexPosting | undefined>(store.get([...scopeKey(query.scope), ...tuple]));
    if (!saved || identity(saved) !== token) throw Error('CORE2_CURSOR_STALE');
    after = ownDto('indexPosting', saved);
  }
  const items: IndexPosting[] = [];
  for (const key of keys) {
    if (after && compare(JSON.stringify(key), JSON.stringify(after.key)) < 0) continue;
    const indexKey = [...scopeKey(query.scope), query.kind!, key];
    await new Promise<void>((resolve, reject) => {
      const cursor = store.index('by_key').openCursor(indexKey);
      let sought = false;
      cursor.onerror = () => reject(cursor.error ?? Error('CORE2_REQUEST_FAILED'));
      cursor.onsuccess = () => {
        try {
          const current = cursor.result;
          if (!current || items.length > limit) { resolve(); return; }
          const row = ownDto('indexPosting', current.value as IndexPosting);
          if (after && after.key === key && identity(row) <= identity(after)) {
            if (!sought && identity(row) < identity(after)) {
              sought = true; current.continuePrimaryKey(indexKey, [...scopeKey(query.scope), row.kind, key, after.target, after.targetId]);
            } else current.continue();
            return;
          }
          if (query.target && row.target !== query.target) {
            if (row.target > query.target) { resolve(); return; }
            current.continuePrimaryKey(indexKey, [...scopeKey(query.scope), row.kind, key, query.target]); return;
          }
          items.push(row);
          if (items.length > limit) { resolve(); return; }
          current.continue();
        } catch (failure) { reject(failure); }
      };
    });
    if (items.length > limit) break;
  }
  if (items.length <= limit) return { items };
  const page = items.slice(0, limit), nextCursor = prefix + identity(page.at(-1)!);
  if (nextCursor.length > 1000) throw Error('CORE2_CURSOR_TOO_LARGE');
  return { items: page, nextCursor };
}
