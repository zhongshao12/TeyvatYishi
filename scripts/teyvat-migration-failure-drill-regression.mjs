import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function loadProductionHarness() {
  const bundled = await build({
    stdin: {
      contents: `
        import 'fake-indexeddb/auto';
        export { persistPartialTeyvatMigration } from './services/teyvatSaveMigration.ts';
        export { saveMigratedTeyvatGameAtomically, getSaveCatalogSnapshot } from './services/dbService.ts';
        export { createTeyvatGameFromOpeningPreset } from './services/teyvatOpeningFactory.ts';
        export { resolveRawMigrationBackupText } from './services/exportService.ts';
      `,
      resolveDir: process.cwd(),
      sourcefile: 'teyvat-migration-failure-production-harness.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
}

const production = await loadProductionHarness();
assert.equal(typeof production.persistPartialTeyvatMigration, 'function');
assert.equal(typeof production.saveMigratedTeyvatGameAtomically, 'function');

const MIGRATION_STORES = ['saves', 'saveSummaries', 'saveAssets', 'saveNodeDeltas'];

async function snapshotMigrationStores() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('TimeJourneyDB');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const snapshots = await Promise.all(MIGRATION_STORES.map((storeName) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = async () => {
        const records = await Promise.all(request.result.map(async (record) => {
          if (!(record?.blob instanceof Blob)) return record;
          return {
            ...record,
            blob: {
              type: record.blob.type,
              size: record.blob.size,
              bytes: Array.from(new Uint8Array(await record.blob.arrayBuffer())),
            },
          };
        }));
        resolve(records);
      };
      request.onerror = () => reject(request.error);
    })));
    return Object.fromEntries(MIGRATION_STORES.map((storeName, index) => [storeName, snapshots[index]]));
  } finally {
    db.close();
  }
}

const unresolvedSourceBytes = '{\r\n  "universe": "partial-teyvat",\r\n  "旅人": { "姓名": "旧旅人", "主命途": "nihility" },\r\n  "背包": []\r\n}';
const unresolvedSource = JSON.parse(unresolvedSourceBytes);
let unresolvedWriteCalls = 0;
let unresolvedCatalogReads = 0;
const unresolved = await production.persistPartialTeyvatMigration(
  unresolvedSource,
  {},
  {
    readCatalogBytes: async () => {
      unresolvedCatalogReads += 1;
      return JSON.stringify(await production.getSaveCatalogSnapshot());
    },
    writeCandidateAtomically: async () => { unresolvedWriteCalls += 1; },
  },
);
assert.equal(unresolved.status, 'needs-input', 'an unresolved historical element must stop before persistence');
assert.equal(unresolvedWriteCalls, 0, 'an unresolved candidate must never reach storage');
assert.equal(unresolvedCatalogReads, 0, 'an unresolved candidate must not open a write transaction');
assert.equal(
  production.resolveRawMigrationBackupText(unresolvedSource, unresolvedSourceBytes),
  unresolvedSourceBytes,
  'the downloadable migration backup must preserve the imported JSON text byte-for-byte',
);

// Seed the real production IndexedDB catalog with one stable save.
const previousState = {
  ...production.createTeyvatGameFromOpeningPreset('official_mondstadt_dragon'),
  saveTree: { rootId: 'migration-root', nodeId: 'migration-node-1' },
};
await production.saveMigratedTeyvatGameAtomically({ ...previousState, type: 'manual', timestamp: 1700000000000 });
const previousCatalogBytes = JSON.stringify(await production.getSaveCatalogSnapshot());
const previousStoreSnapshot = await snapshotMigrationStores();

const validSourceBytes = '{\n  "universe": "partial-teyvat",\n  "旅人": { "姓名": "旧旅人", "主命途": "hunt" },\n  "背包": []\n}\n';
const validSource = JSON.parse(validSourceBytes);
assert.equal(
  production.resolveRawMigrationBackupText(validSource, validSourceBytes),
  validSourceBytes,
  'valid migration backup text must retain whitespace and trailing newline exactly',
);

let producedCandidate = false;
let reachedProductionTransactionBarrier = false;
let migrationCandidate;
await assert.rejects(
  production.persistPartialTeyvatMigration(
    validSource,
    {},
    {
      readCatalogBytes: async () => JSON.stringify(await production.getSaveCatalogSnapshot()),
      writeCandidateAtomically: async (candidate) => {
        producedCandidate = true;
        assert.equal(candidate.universe, 'teyvat');
        assert.equal(candidate.schemaVersion, 2);
        assert.equal(candidate.旅行者.主元素, 'electro');
        migrationCandidate = {
          ...candidate,
          type: 'auto',
          timestamp: 1800000000000,
          saveTree: { rootId: 'migration-root', nodeId: 'migration-node-2', parentNodeId: 'migration-node-1' },
          相册: {
            ...candidate.相册,
            assets: [{
              id: 'migration-asset',
              dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
              mimeType: 'image/png',
              source: 'upload',
              nsfw: false,
              createdAt: 1800000000000,
              referenceImageIds: [],
              status: 'ready',
            }],
          },
        };
        await production.saveMigratedTeyvatGameAtomically(
          migrationCandidate,
          {
            afterIndexedDbStaging: () => {
              reachedProductionTransactionBarrier = true;
              throw new Error('INJECTED_STORAGE_WRITE_FAILURE');
            },
          },
        );
      },
    },
  ),
  /INJECTED_STORAGE_WRITE_FAILURE/,
  'a failure after production save/catalog writes are staged must abort the transaction',
);

const catalogBytesAfterFailure = JSON.stringify(await production.getSaveCatalogSnapshot());
const storeSnapshotAfterFailure = await snapshotMigrationStores();
assert.equal(producedCandidate, true, 'the failure must happen after a valid migration candidate is produced');
assert.equal(reachedProductionTransactionBarrier, true, 'the injected failure must run inside the production IndexedDB transaction');
assert.equal(
  catalogBytesAfterFailure,
  previousCatalogBytes,
  'the aborted production transaction must preserve the previous catalog byte-for-byte',
);
assert.deepEqual(
  storeSnapshotAfterFailure,
  previousStoreSnapshot,
  'the aborted production transaction must preserve saves, catalog, assets, and deltas completely',
);
assert.equal(
  production.resolveRawMigrationBackupText(validSource, validSourceBytes),
  validSourceBytes,
  'failed persistence must leave the exact imported source JSON text available for backup',
);

assert.ok(migrationCandidate, 'the drill must retain the same asset-and-delta candidate for its control commit');
await production.saveMigratedTeyvatGameAtomically(migrationCandidate);
const committedStoreSnapshot = await snapshotMigrationStores();
for (const storeName of MIGRATION_STORES) {
  assert.equal(
    committedStoreSnapshot[storeName].length,
    previousStoreSnapshot[storeName].length + 1,
    `the control commit must prove the same candidate writes ${storeName}`,
  );
}

console.log('[teyvat-migration-failure-drill-regression] PASS 2/2 (all four production IndexedDB stores aborted)');
