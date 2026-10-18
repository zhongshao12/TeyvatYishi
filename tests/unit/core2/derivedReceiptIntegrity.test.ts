import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { makeMemory, makeSeed } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';

// Simulate a checksum collision below the real repository. A checksum is an
// accelerator, not proof that two publication payloads have equal contents.
vi.mock('@/core/sources/sourceIntegrity', () => ({ checksumUtf8: () => '0000000000000000' }));

it('equal checksums do not acknowledge a different memory as an exact saved replay', async () => {
  const repo = createIndexedRepository({ databaseName: 'test-core2-derived-collision', factory: new IDBFactory() });
  const seed = makeSeed(), batch = makeBatch(seed);
  await repo.initialize(seed); await prepareBatch(repo, batch); await repo.commit(batch);
  await repo.claimJob({ scope: batch.scope, sessionId: batch.sessionId, jobId: batch.jobs[0]!.jobId,
    leaseId: 'lease-one', sourceRefs: batch.sourceRefs, expectedVersion: 1 });
  const memory = makeMemory({ scope: batch.scope, sourceRefs: batch.sourceRefs, eventIds: [batch.events[0]!.eventId] });
  const patch = { scope: batch.scope, sessionId: batch.sessionId, jobId: batch.jobs[0]!.jobId, leaseId: 'lease-one',
    sourceRefs: batch.sourceRefs, readSet: [], expectedMemoryRevision: 0, additions: [memory], supersededIds: [] };
  expect((await repo.publishDerived(patch)).status).toBe('published');
  expect((await repo.publishDerived({ ...patch, additions: [{ ...memory, text: '不是已经保存的原结果。' }] })).status).toBe('conflict');
  expect((await repo.queryMemories({ scope: batch.scope, cutoffSeq: 1, memoryRevision: 1 })).items[0]!.text).toBe('安柏赠送苹果。');
});
