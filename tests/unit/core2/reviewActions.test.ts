import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { settleCoreOperation } from '@/core/settlement/settleOperation';
import { reviewPendingCandidate, editCoreProfile, correctCoreEvent } from '@/core/settlement/reviewActions';
import { makeSeed, makeCandidate, makeSource } from './fixtures';

async function fixture() {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-review-${crypto.randomUUID()}` });
  const seed = makeSeed(); await repo.initialize(seed);
  const source = makeSource({ scope: seed.head.scope, operationId: 'uncertain', blocks: [{ blockId: 'body-1', kind: 'narration', text: '玩家似乎打算使用两枚苹果。' }] });
  const candidate = makeCandidate({ scope: source.scope, operationId: source.operationId, proposal: { kind: 'inventory', action: 'consume', itemId: 'apple', quantity: 2 }, actors: [seed.playerId], targets: ['apple'], evidenceRefs: [{ ref: source.ref, blockId: 'body-1', start: 0, end: source.blocks[0]!.text.length, quote: source.blocks[0]!.text }] });
  const deps = { rulePolicy: { ruleVersion: 'test', storyNodes: [] } };
  await settleCoreOperation({ scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: source.operationId, kind: 'main', sources: [source] }, { repo, ...deps, factModel: async () => ({ kind: 'extracted', candidates: [candidate], attempts: 1 }) });
  return { repo, seed, source, candidate, deps };
}
it('revalidates current stock on explicit confirmation, rather than accepting stale proposed changes', async () => {
  const { repo, seed, candidate, source, deps } = await fixture();
  await expect(reviewPendingCandidate(repo, { scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: 'review-new', originOperationId: source.operationId, candidateId: candidate.candidateId, sourceVersion: 1, decision: 'accept' }, deps)).rejects.toThrow('库存');
  expect((await repo.readState(seed.head.scope)).records.find(row => row.domain === 'inventory' && row.entityId === 'apple')?.value).toMatchObject({ quantity: 1 });
});
it('records a rejection once without granting affinity or NPC knowledge, retaining the original receipt', async () => {
  const { repo, seed, candidate, source, deps } = await fixture();
  const original = await repo.readOperation(seed.head.scope, source.operationId);
  const action = { scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: 'review-reject', originOperationId: source.operationId, candidateId: candidate.candidateId, sourceVersion: 1, decision: 'reject' as const };
  expect((await reviewPendingCandidate(repo, action, deps)).status).toBe('committed');
  await reviewPendingCandidate(repo, { ...action, operationId: 'different-id' }, deps);
  expect(await repo.readOperation(seed.head.scope, source.operationId)).toEqual(original);
  expect((await repo.readState(seed.head.scope)).records.find(row => row.domain === 'npc')?.value).toMatchObject({ affinity: 10 });
  expect((await repo.queryKnowledge({ scope: seed.head.scope, cutoffSeq: 2 })).items).toEqual([]);
  expect((await repo.readHead(seed.head.scope)).coreSeq).toBe(2);
});
it('edits one registered field and makes corrections as new events, never rewriting a previous event', async () => {
  const { repo, seed, deps } = await fixture();
  const first = await editCoreProfile(repo, { scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: 'edit-name', command: { type: 'edit_traveler', field: '姓名', value: '新名字' } }, deps);
  const old = (await repo.queryEvents({ scope: seed.head.scope, cutoffSeq: first.coreSeq, eventIds: first.eventIds })).items[0]!;
  await correctCoreEvent(repo, { scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: 'correct-name', originalEventId: old.eventId, reason: '更正笔误', command: { type: 'edit_traveler', field: '姓名', value: '云' } }, deps);
  expect((await repo.queryEvents({ scope: seed.head.scope, cutoffSeq: 3, types: ['player.correct_event'] })).items[0]?.correctionOf).toBe(old.eventId);
  expect((await repo.queryEvents({ scope: seed.head.scope, cutoffSeq: 3, eventIds: [old.eventId] })).items[0]).toEqual(old);
  expect((await repo.readState(seed.head.scope)).records.find(row => row.domain === 'traveler')?.value).toMatchObject({ id: seed.playerId, 姓名: '云' });
});
it('retries the same explicit edit without creating a new source or applying the edit twice', async () => {
  const { repo, seed, deps } = await fixture();
  const input = { scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: 'edit-once', command: { type: 'edit_traveler' as const, field: '姓名' as const, value: '小云' } };
  const first = await editCoreProfile(repo, input, deps);
  expect((await editCoreProfile(repo, input, deps)).status).toBe('already_committed');
  expect((await repo.readHead(seed.head.scope)).coreSeq).toBe(first.coreSeq);
  await expect(editCoreProfile(repo, { ...input, command: { ...input.command, value: '其他' } }, deps)).rejects.toThrow('SOURCE_MISMATCH');
});
