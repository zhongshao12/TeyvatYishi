import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCheckpoint } from '@/core/persistence/snapshots';
import { checksumUtf8 } from '@/core/sources/sourceIntegrity';
import { stableJson } from '@/core/persistence/repositoryValidation';
import { makeSeed } from './fixtures';
import { assertCheckpointRepositoryContract } from './checkpointRepositoryContract';

assertCheckpointRepositoryContract(async () => createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-periodic-${crypto.randomUUID()}` }));

it('captures an immutable save payload without advancing world time or either storage clock', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-checkpoint' });
  const seed = makeSeed(); await repo.initialize(seed); const before = await repo.readState(seed.head.scope);
  const snapshot = await createCheckpoint(repo, seed.head.scope);
  expect(snapshot.state).toEqual(before); expect(snapshot.coreSeq).toBe(0); expect(snapshot.memoryRevision).toBe(0);
  expect(snapshot.checksum).toBe(checksumUtf8(stableJson(before)));
  expect(await repo.readState(seed.head.scope)).toEqual(before);
});
it('owns the requested scope before awaiting and returns a separate state copy', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-checkpoint-owned' });
  const seed = makeSeed(); await repo.initialize(seed); const scope = { ...seed.head.scope };
  const pending = createCheckpoint(repo, scope); scope.branchId = 'unrelated';
  const snapshot = await pending; expect(snapshot.scope).toEqual(seed.head.scope);
  snapshot.state.records.splice(0); expect((await repo.readState(seed.head.scope)).records).toHaveLength(seed.records.length);
});
