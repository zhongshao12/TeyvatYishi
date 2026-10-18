import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { readCoreTurnMaterial } from '@/core/memory/turnMaterial';
import { makeSeed } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';
it('reads every event in a large selected turn without truncation or an oversized query cursor', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-material-${crypto.randomUUID()}` }), seed = makeSeed();
  const batch = makeBatch(seed);
  for (let index = 1; index < 260; index++) batch.events.push({ ...structuredClone(batch.events[0]!), eventId: `event-extra-${index}`, committedChanges: [] });
  await repo.initialize(seed); await prepareBatch(repo, batch); await repo.commit(batch);
  const result = await readCoreTurnMaterial(repo, { scope: seed.head.scope, cutoffSeq: 1, operationId: batch.operationId });
  expect(result.events).toHaveLength(260); expect(result.sources.map(source => source.ref)).toEqual(batch.sourceRefs);
});
