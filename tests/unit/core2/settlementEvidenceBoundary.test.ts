import { expect, it } from 'vitest';
import { makeNodeRepository } from './nodeCorpusSession';
import { makeCandidate, makeMemory, makeSeed, makeSource } from './fixtures';
import { settleCoreOperation } from '@/core/settlement/settleOperation';
import { reviewPendingCandidate } from '@/core/settlement/reviewActions';
import { buildCoreConsumerContext } from '@/core/retrieval/consumerContext';

async function fixture() {
  const seed = makeSeed(), quest = seed.records.find(row => row.domain === 'quest');
  if (quest?.domain !== 'quest') throw Error('fixture');
  quest.value.objectives = [{ id: 'give-apple', type: 'collect', description: '交出苹果', targetCount: 1, currentCount: 0, completed: false }];
  const text = '玩家把几枚苹果交给安柏，任务进度增加一次。', source = makeSource({ scope: seed.head.scope, blocks: [{ blockId: 'give', kind: 'narration', text }, { blockId: 'weather', kind: 'narration', text: '天开始下雨。' }] });
  const evidence = { ref: source.ref, blockId: 'give', start: 0, end: text.length, quote: text }, candidates = [
    makeCandidate({ candidateId: 'give', scope: seed.head.scope, operationId: source.operationId, actors: [seed.playerId], targets: ['npc-amber'], proposal: { kind: 'inventory', action: 'give', itemId: 'apple', quantity: 1, recipientId: 'npc-amber' }, evidenceRefs: [evidence] }),
    makeCandidate({ candidateId: 'progress', kind: 'quest', scope: seed.head.scope, operationId: source.operationId, actors: [seed.playerId], targets: ['quest-1'], proposal: { kind: 'quest', questId: 'quest-1', action: 'progress', objectiveId: 'give-apple', amount: 1 }, evidenceRefs: [evidence] }),
    makeCandidate({ candidateId: 'weather', kind: 'weather', scope: seed.head.scope, operationId: source.operationId, actors: [], targets: [], proposal: { kind: 'weather', weather: '雨' }, evidenceRefs: [{ ref: source.ref, blockId: 'weather', start: 0, end: 6, quote: '天开始下雨。' }] }),
  ];
  const repo = makeNodeRepository(`test-core2-evidence-group-${crypto.randomUUID()}`); await repo.initialize(seed);
  const deps = { repo, rulePolicy: { ruleVersion: 'test', storyNodes: [] }, factModel: async () => ({ kind: 'extracted' as const, candidates, attempts: 0 }) };
  const receipt = await settleCoreOperation({ scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: source.operationId, kind: 'main', sources: [source] }, deps);
  return { repo, seed, source, text, receipt, deps };
}
it('holds an uncertain required dependency and its quest effect together without blocking independent weather', async () => {
  const f = await fixture(), snapshot = await f.repo.readState(f.seed.head.scope);
  expect(snapshot.records.find(row => row.entityId === 'apple')?.value).toMatchObject({ quantity: 1 });
  expect(snapshot.records.find(row => row.domain === 'quest')?.value).toMatchObject({ objectives: [{ currentCount: 0, completed: false }] });
  expect(snapshot.records.find(row => row.domain === 'world')?.value).toMatchObject({ moment: { weather: '雨' } });
  expect((await f.repo.readOperation(f.seed.head.scope, f.source.operationId))?.stage?.candidates.filter(row => ['give', 'progress'].includes(row.candidateId)).every(row => row.status === 'pending')).toBe(true);
});
it('confirms the disclosed dependency group atomically and makes confirmation by either member idempotent', async () => {
  const f = await fixture(), input = { scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, operationId: 'review-group', originOperationId: f.source.operationId, candidateId: 'progress', sourceVersion: 1, decision: 'accept' as const };
  expect((await reviewPendingCandidate(f.repo, input, f.deps)).status).toBe('committed');
  const snapshot = await f.repo.readState(f.seed.head.scope);
  expect(snapshot.records.find(row => row.entityId === 'apple')?.value).toMatchObject({ quantity: 0 });
  expect(snapshot.records.find(row => row.domain === 'quest')?.value).toMatchObject({ objectives: [{ currentCount: 1, completed: true }] });
  expect((await reviewPendingCandidate(f.repo, { ...input, operationId: 'review-other-member', candidateId: 'give' }, f.deps)).status).toBe('already_committed');
});
it('does not turn a completion anchor or its pinned summary into confirmed evidence for disputed prose', async () => {
  const f = await fixture(), head = await f.repo.readHead(f.seed.head.scope), completion = (await f.repo.queryEvents({ scope: head.scope, cutoffSeq: head.coreSeq, types: ['turn.complete'] })).items[0]!;
  const job = (await f.repo.queryJobs({ scope: head.scope, cutoffSeq: head.coreSeq, jobIds: f.receipt.jobIds })).items[0]!;
  const claimed = await f.repo.claimJob({ scope: head.scope, sessionId: head.sessionId, jobId: job.jobId, leaseId: 'anchor-summary', sourceRefs: job.sourceRefs, expectedVersion: job.version });
  const memory = makeMemory({ scope: head.scope, text: f.text, pinned: true, eventIds: [completion.eventId], sourceRefs: [f.source.ref], momentRange: { start: completion.occurredMoment, end: completion.occurredMoment, sourceIds: [f.source.ref.sourceId] } });
  expect((await f.repo.publishDerived({ scope: head.scope, sessionId: head.sessionId, jobId: job.jobId, leaseId: claimed!.leaseId!, sourceRefs: job.sourceRefs, readSet: [], expectedMemoryRevision: head.memoryRevision, additions: [memory], supersededIds: [] })).status).toBe('published');
  const snapshot = await f.repo.readState(head.scope), context = await buildCoreConsumerContext({ snapshot, target: 'main', npcIds: [], userInput: '苹果和天气' }, { repo: f.repo });
  expect(context.prompt).not.toContain(f.text); expect(context.bundle.selectedLeafIds).not.toContain(completion.eventId);
  expect(context.prompt).toContain('天开始下雨');
});
