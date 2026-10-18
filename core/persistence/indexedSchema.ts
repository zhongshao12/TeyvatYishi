export const CORE2_DATABASE_NAME = 'TeyvatCore2DB';
export const CORE2_DATABASE_VERSION = 1;

const layouts = {
  branches: ['head.scope.journeyId', 'head.scope.branchId'],
  states: ['scope.journeyId', 'scope.branchId', 'domain', 'entityId'],
  sources: ['record.ref.sourceId', 'record.ref.sourceVersion'],
  sourcePositions: ['ref.sourceId','ref.sourceVersion'],
  operations: ['scope.journeyId', 'scope.branchId', 'operationId'],
  events: 'eventId',
  effects: ['scope.journeyId', 'scope.branchId', 'effectKey'],
  memories: ['record.scope.journeyId', 'record.scope.branchId', 'record.memoryId', 'record.version'],
  knowledge: ['scope.journeyId', 'scope.branchId', 'knowledgeId', 'version'],
  commitments: ['scope.journeyId', 'scope.branchId', 'commitmentId', 'version'],
  jobs: ['record.scope.journeyId', 'record.scope.branchId', 'record.jobId'],
  snapshots: 'snapshotId',
  slots: 'slotId',
  assets: 'assetId',
  indexMeta: ['scope.journeyId', 'scope.branchId'],
  postings: ['scope.journeyId', 'scope.branchId', 'kind', 'key', 'target', 'targetId'],
} satisfies Record<string, string | string[]>;
export type CoreStoreName = keyof typeof layouts;
export const CORE2_STORES = Object.keys(layouts) as CoreStoreName[];

const indexes: Partial<Record<CoreStoreName, Record<string, string | string[]>>> = {
  branches: { by_journey: 'head.scope.journeyId' },
  states: { by_scope: ['scope.journeyId', 'scope.branchId'] },
  sources: { by_scope: ['record.scope.journeyId', 'record.scope.branchId'], by_position: ['record.scope.journeyId', 'record.scope.branchId', 'commitSeq'], by_operation: ['record.scope.journeyId', 'record.scope.branchId', 'record.operationId'] },
  sourcePositions: {by_scope:['scope.journeyId','scope.branchId']},
  operations: { by_status: ['scope.journeyId', 'scope.branchId', 'status'] },
  events: { by_position: ['journeyId', 'branchId', 'commitSeq'], by_scope: ['journeyId', 'branchId'] },
  memories: { by_position: ['record.scope.journeyId', 'record.scope.branchId', 'publishedRevision'], by_scope: ['record.scope.journeyId', 'record.scope.branchId'], by_entity: ['record.scope.journeyId', 'record.scope.branchId', 'record.memoryId'] },
  knowledge: { by_scope: ['scope.journeyId', 'scope.branchId'], by_entity: ['scope.journeyId', 'scope.branchId', 'knowledgeId'], by_npc: ['scope.journeyId', 'scope.branchId', 'record.npcId'] },
  commitments: { by_scope: ['scope.journeyId', 'scope.branchId'], by_entity: ['scope.journeyId', 'scope.branchId', 'commitmentId'], by_status: ['scope.journeyId', 'scope.branchId', 'record.status'] },
  jobs: { by_scope: ['scope.journeyId', 'scope.branchId'], by_journey: 'scope.journeyId', by_operation: ['scope.journeyId', 'scope.branchId', 'record.operationId'], by_status: ['record.scope.journeyId', 'record.scope.branchId', 'record.status'] },
  snapshots: { by_position: ['scope.journeyId', 'scope.branchId', 'coreSeq'] },
  slots: { by_journey: 'journeyId', by_turn: ['journeyId', 'kind', 'turn'] },
  postings: { by_key: ['scope.journeyId', 'scope.branchId', 'kind', 'key'], by_scope: ['scope.journeyId', 'scope.branchId'] },
};

function createSchema(db: IDBDatabase): void {
  for (const name of CORE2_STORES) {
    const store = db.createObjectStore(name, { keyPath: layouts[name] });
    for (const [key, path] of Object.entries(indexes[name] ?? {})) store.createIndex(key, path);
  }
}
function schemaMatches(db: IDBDatabase): boolean {
  if (!CORE2_STORES.every(store => db.objectStoreNames.contains(store))) return false;
  const tx = db.transaction(CORE2_STORES, 'readonly');
  return CORE2_STORES.every(name => {
    const store = tx.objectStore(name);
    return !store.autoIncrement && JSON.stringify(store.keyPath) === JSON.stringify(layouts[name]) && Object.entries(indexes[name] ?? {}).every(([key, path]) => {
      if (!store.indexNames.contains(key)) return false;
      const index = store.index(key);
      return !index.unique && !index.multiEntry && JSON.stringify(index.keyPath) === JSON.stringify(path);
    });
  });
}

export function openCoreDatabase(name = 'TeyvatCore2DB', factory: IDBFactory = globalThis.indexedDB): Promise<IDBDatabase> {
  if (name === 'TimeJourneyDB') return Promise.reject(new Error('CORE2_LEGACY_DATABASE_FORBIDDEN'));
  if (name !== CORE2_DATABASE_NAME && !name.startsWith('test-core2-')) return Promise.reject(new Error('CORE2_INVALID_DATABASE_NAMESPACE'));
  if (!factory) return Promise.reject(new Error('CORE2_INDEXEDDB_UNAVAILABLE'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = factory.open(name, CORE2_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      createSchema(db);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      if (!schemaMatches(db)) {
        db.close(); reject(new Error('CORE2_SCHEMA_MISMATCH')); return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => { if (!settled) { settled = true; reject(request.error ?? new Error('CORE2_OPEN_FAILED')); } };
    request.onblocked = () => { if (!settled) { settled = true; reject(new Error('CORE2_DATABASE_OPEN_BLOCKED')); } };
  });
}
