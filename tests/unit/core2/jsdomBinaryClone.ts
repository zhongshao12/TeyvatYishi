/** fake-indexeddb uses Node's structuredClone in jsdom. Its typed arrays belong
 * to Node's realm, whereas real IndexedDB returns bytes in the caller's realm.
 * Repair that harness mismatch, never weaken production byte/prototype checks. */
export function cloneInCurrentBinaryRealm<T>(value: T, nativeClone: typeof structuredClone): T {
  const result = nativeClone(value), seen = new Map<object, unknown>();
  const repair = (item: unknown): unknown => {
    if (!item || typeof item !== 'object') return item;
    if (seen.has(item)) return seen.get(item);
    const tag = Object.prototype.toString.call(item);
    if (tag === '[object Uint8Array]') {
      const source = item as Uint8Array, owned = new Uint8Array(source.length); owned.set(source); seen.set(item, owned); return owned;
    }
    if (tag === '[object ArrayBuffer]') {
      const source = new Uint8Array(item as ArrayBuffer), owned = new Uint8Array(source.length); owned.set(source); seen.set(item, owned.buffer); return owned.buffer;
    }
    seen.set(item, item);
    if (Array.isArray(item)) for (let index = 0; index < item.length; index++) item[index] = repair(item[index]);
    else if (tag === '[object Object]') for (const key of Object.keys(item)) (item as Record<string, unknown>)[key] = repair((item as Record<string, unknown>)[key]);
    return item;
  };
  return repair(result) as T;
}
