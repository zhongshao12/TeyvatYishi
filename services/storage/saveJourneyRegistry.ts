import type { SaveCatalogSnapshot, SaveListItemSummary } from './saveCatalog';
import { openGameDatabase, SETTINGS_STORE } from './gameDatabase';
import { createAppStorageAdapter } from './appStorageAdapter';
import { withDesktopStorageLock } from '@/services/desktop/desktopStorageLock';
import { isDesktopRuntime } from '@/utils/platform/desktopRuntime';
import { getSaveJourneyIdentity } from '@/utils/saveJourneyLabel';

export const SAVE_JOURNEY_REGISTRY_KEY = 'internal.saveJourneyRegistry.v1';
export const SAVE_JOURNEY_REGISTRY_PATH = 'saves/journey-registry.json';
interface Allocation { name: string; ordinal: number }
interface Registry {
  version: 1;
  roots: Array<{ identity: string; allocations: Allocation[] }>;
  counters: Array<{ name: string; lastOrdinal: number }>;
}
interface Journey { identity: string; name: string; timestamp: number; id: number }

export async function attachSaveJourneyLabels(snapshot: SaveCatalogSnapshot): Promise<SaveCatalogSnapshot> {
  const all = [...snapshot.items, ...snapshot.legacyBackups];
  if (!all.length) return snapshot;
  const journeys = collectJourneys(all);
  // Never enter saveMutationPriority here: callers may already own that queue.
  const allocations = isDesktopRuntime()
    ? await allocateDesktop(journeys)
    : await allocateIndexed(journeys);
  const attach = (item: SaveListItemSummary) => ({ ...item, ...allocations.get(getSaveJourneyIdentity(item)) });
  return { ...snapshot, items: snapshot.items.map(attach), legacyBackups: snapshot.legacyBackups.map(attach) };
}

async function allocateDesktop(journeys: Journey[]) {
  const adapter = createAppStorageAdapter();
  const read = async () => {
    const raw = await adapter.readText(SAVE_JOURNEY_REGISTRY_PATH);
    return readRegistry(raw === null ? undefined : JSON.parse(raw));
  };
  // Existing associations are immutable. An atomic file read can return them
  // without even creating/removing a lock file on each catalog view.
  const knownLabels = getKnownLabels(await read(), journeys);
  if (knownLabels) return knownLabels;
  return withDesktopStorageLock('save-journey-registry', async () => {
    // Another instance may have allocated after our initial read. Reread under
    // the existing cross-instance lock before making any allocation or write.
    const registry = await read();
    const result = allocate(registry, journeys);
    if (result.changed) await adapter.writeJson(SAVE_JOURNEY_REGISTRY_PATH, registry);
    return result.labels;
  });
}

function getKnownLabels(registry: Registry, journeys: Journey[]): ReturnType<typeof allocate>['labels'] | null {
  const labels: ReturnType<typeof allocate>['labels'] = new Map();
  for (const journey of journeys) {
    const entry = registry.roots.find(root => root.identity === journey.identity)
      ?.allocations.find(entry => entry.name === journey.name);
    if (!entry) return null;
    labels.set(journey.identity, { journeyOrdinal: entry.ordinal, journeyDisplayName: journey.name });
  }
  return labels;
}

function collectJourneys(items: SaveListItemSummary[]): Journey[] {
  const byIdentity = new Map<string, SaveListItemSummary[]>();
  for (const item of items) {
    const identity = getSaveJourneyIdentity(item);
    const bucket = byIdentity.get(identity) ?? [];
    bucket.push(item); byIdentity.set(identity, bucket);
  }
  return [...byIdentity].map(([identity, nodes]) => {
    const sorted = [...nodes].sort((a, b) => b.timestamp - a.timestamp || b.id - a.id);
    const oldest = sorted[sorted.length - 1]!;
    const name = sorted.find(node => node.travelerName.trim())?.travelerName.trim() || '未命名旅人';
    return { identity, name, timestamp: oldest.timestamp, id: oldest.id };
  }).sort((a, b) => a.timestamp - b.timestamp || a.id - b.id || a.identity.localeCompare(b.identity));
}

function readRegistry(raw: unknown): Registry {
  if (raw === undefined) return { version: 1, roots: [], counters: [] };
  const fail = () => { throw new Error('旅程编号注册表损坏；已停止分配，避免复用旧编号。'); };
  if (!raw || typeof raw !== 'object') return fail();
  const value = raw as Registry;
  if (value.version !== 1 || !Array.isArray(value.roots) || !Array.isArray(value.counters)) return fail();
  const identities = new Set<string>(); const names = new Set<string>(); const used = new Set<string>();
  const maxima = new Map<string, number>();
  for (const root of value.roots) {
    if (!root || typeof root.identity !== 'string' || !root.identity || identities.has(root.identity) || !Array.isArray(root.allocations) || !root.allocations.length) return fail();
    identities.add(root.identity); const rootNames = new Set<string>();
    for (const entry of root.allocations) {
      if (!entry || typeof entry.name !== 'string' || !entry.name.trim() || entry.name !== entry.name.trim() || !Number.isSafeInteger(entry.ordinal) || entry.ordinal < 1 || rootNames.has(entry.name)) return fail();
      const key = JSON.stringify([entry.name, entry.ordinal]); if (used.has(key)) return fail();
      rootNames.add(entry.name); used.add(key); maxima.set(entry.name, Math.max(maxima.get(entry.name) ?? 0, entry.ordinal));
    }
  }
  for (const counter of value.counters) {
    if (!counter || typeof counter.name !== 'string' || !counter.name.trim() || counter.name !== counter.name.trim() || names.has(counter.name) || !Number.isSafeInteger(counter.lastOrdinal) || counter.lastOrdinal < 1 || counter.lastOrdinal < (maxima.get(counter.name) ?? 0)) return fail();
    names.add(counter.name);
  }
  if ([...maxima.keys()].some(name => !names.has(name))) return fail();
  return value;
}

function allocate(registry: Registry, journeys: Journey[]) {
  let changed = false;
  const labels = new Map<string, { journeyOrdinal: number; journeyDisplayName: string }>();
  for (const journey of journeys) {
    let root = registry.roots.find(entry => entry.identity === journey.identity);
    if (!root) { root = { identity: journey.identity, allocations: [] }; registry.roots.push(root); }
    let entry = root.allocations.find(entry => entry.name === journey.name);
    if (!entry) {
      let counter = registry.counters.find(entry => entry.name === journey.name);
      if (!counter) { counter = { name: journey.name, lastOrdinal: 0 }; registry.counters.push(counter); }
      if (counter.lastOrdinal >= Number.MAX_SAFE_INTEGER) throw new Error('旅程编号已达到安全整数上限。');
      entry = { name: journey.name, ordinal: ++counter.lastOrdinal }; root.allocations.push(entry); changed = true;
    }
    labels.set(journey.identity, { journeyOrdinal: entry.ordinal, journeyDisplayName: journey.name });
  }
  return { changed, labels };
}

async function allocateIndexed(journeys: Journey[]) {
  const db = await openGameDatabase();
  return new Promise<ReturnType<typeof allocate>['labels']>((resolve, reject) => {
    // One readwrite RMW transaction serializes separate tabs, not just module calls.
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE); const request = store.get(SAVE_JOURNEY_REGISTRY_KEY);
    let labels: ReturnType<typeof allocate>['labels']; let failure: unknown;
    request.onsuccess = () => {
      try {
        const registry = readRegistry(request.result === undefined ? undefined : request.result.value ?? null);
        const result = allocate(registry, journeys); labels = result.labels;
        if (result.changed) store.put({ key: SAVE_JOURNEY_REGISTRY_KEY, value: registry });
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(labels);
    tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? new Error('旅程编号持久化失败。'));
  });
}
