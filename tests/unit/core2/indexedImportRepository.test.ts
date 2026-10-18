import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assertImportRepositoryContract, makeImportFixture } from './importRepositoryContract';

assertImportRepositoryContract(async () => createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-import-${crypto.randomUUID()}` }));

describe('all-store import rollback', () => {
  for (const point of ['import:states', 'import:ledger', 'import:derived', 'import:assets', 'import:heads'] as const) {
    it(`does not publish any journey records after ${point} fails`, async () => {
      const fixtureRepo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-fixture-${crypto.randomUUID()}` });
      const { value } = await makeImportFixture(fixtureRepo);
      const factory = new IDBFactory(), databaseName = `test-core2-import-fault-${crypto.randomUUID()}`;
      const repo = createIndexedRepository({ factory, databaseName, fault: current => { if (current === point) throw new Error('injected-import'); } });
      expect(typeof repo.importPrepared).toBe('function');
      await expect(repo.importPrepared(value)).rejects.toThrow('injected-import');
      const reopened = createIndexedRepository({ factory, databaseName });
      await expect(reopened.readHead(value.manifest.scope)).rejects.toThrow('CORE2_BRANCH_NOT_FOUND');
      expect(await reopened.readSnapshot(value.manifest.snapshotId)).toBeNull();
      expect(await reopened.readAsset('asset-fixture')).toBeNull();
      expect(await reopened.readSource(value.sources[0]!.record.ref)).toBeNull();
      expect(await reopened.listSaveSlots(value.manifest.scope.journeyId)).toEqual([]);
      expect((await reopened.importPrepared(value)).scope).toEqual(value.manifest.scope);
    });
  }
});
