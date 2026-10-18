import { IDBFactory } from 'fake-indexeddb';
import { expect } from 'vitest';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import type { MemoryRecord } from '@/core/contracts/memory';
import type { PreparedCommit } from '@/core/contracts/operation';
import { makeMemory, makeSeed } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';
import { nextBatch } from './snapshotRepositoryContract';

export async function recallFixture(count = 3) {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-recall-${crypto.randomUUID()}` }), seed = makeSeed();
  await repo.initialize(seed);
  const batches: PreparedCommit[] = [];
  for (let i = 0; i < count; i++) {
    const batch = i ? await nextBatch(repo, seed.head.scope) : makeBatch(seed);
    batch.jobs = []; batch.commitments = []; batch.knowledge = [];
    const event = batch.events[0]!;
    event.eventId = `recall-event-${String(i + 1).padStart(3, '0')}`; event.turn = i + 1;
    event.visibility = { kind: i === 1 ? 'private' : 'public', npcIds: i === 1 ? ['npc-lisa'] : [] };
    event.actorIds = [i === 1 ? 'npc-lisa' : 'npc-amber'];
    event.occurredMoment = { ...event.occurredMoment, turn: i + 1, settlementId: batch.operationId };
    batch.knowledge = [{ knowledgeId: `recall-knowledge-${i}`, scope: batch.scope, npcId: event.actorIds[0]!, eventId: event.eventId,
      mode: 'witnessed', evidenceRefs: event.evidenceRefs, learnedMoment: event.occurredMoment, nature: 'fact', version: 1 }];
    await prepareBatch(repo, batch); expect((await repo.commit(batch)).status).toBe('committed'); batches.push(batch);
  }
  const publish = async (overrides: Partial<MemoryRecord>) => {
    const head = await repo.readHead(seed.head.scope), jobId = `recall-job-${crypto.randomUUID()}`, leaseId = `lease-${crypto.randomUUID()}`;
    const memory = makeMemory({ scope: seed.head.scope, memoryId: `recall-memory-${crypto.randomUUID()}`, sourceRefs: batches[0]!.sourceRefs,
      eventIds: [batches[0]!.events[0]!.eventId], text: '风起地的蒲公英与苹果', ...overrides });
    await repo.enqueueJob({ jobId, scope: head.scope, sessionId: head.sessionId, kind: 'manual_memory', operationId: batches[0]!.operationId,
      sourceRefs: memory.sourceRefs, configFingerprint: 'recall-fixture', status: 'pending', leaseId: null, attempts: 0, steps: [], version: 1 });
    await repo.claimJob({ scope: head.scope, sessionId: head.sessionId, jobId, leaseId, sourceRefs: memory.sourceRefs, expectedVersion: 1 });
    expect((await repo.publishDerived({ scope: head.scope, sessionId: head.sessionId, jobId, leaseId, sourceRefs: memory.sourceRefs,
      expectedMemoryRevision: head.memoryRevision, readSet: [...memory.memoryRefs, ...(memory.version > 1 ? [{ memoryId: memory.memoryId, version: memory.version - 1 }] : [])], additions: [memory], supersededIds: [] })).status).toBe('published');
    await repo.finishJob({ scope: head.scope, sessionId: head.sessionId, jobId, leaseId, sourceRefs: memory.sourceRefs, expectedVersion: 2, status: 'completed' });
    return memory;
  };
  const request = async () => ({ scope: seed.head.scope, head: await repo.readHead(seed.head.scope), audience: { target: 'main' as const, npcIds: [] as string[] },
    entityIds: ['npc-amber'], locations: ['蒙德城'], query: '蒲公英 苹果', moment: structuredClone(batches[0]!.events[0]!.occurredMoment) });
  return { repo, seed, batches, publish, request };
}
