import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { settleCoreOperation } from '@/core/settlement/settleOperation';
import { recoverCoreOperation } from '@/core/settlement/operationRecovery';
import { makeCandidate, makeSeed, makeSource, makeMemory } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';

async function setup(text = '安柏把两枚苹果放入玩家背包。') {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-settle-${crypto.randomUUID()}` });
  const seed = makeSeed(); await repo.initialize(seed);
  const source = makeSource({ scope: seed.head.scope, operationId: 'op-settle', blocks: [{ blockId: 'body', kind: 'narration', text }] });
  const candidate = makeCandidate({ scope: seed.head.scope, operationId: source.operationId, targets: [seed.playerId], proposal: { kind: 'inventory', action: 'gain', itemId: 'apple', quantity: 2 }, evidenceRefs: [{ ref: source.ref, blockId: 'body', start: 0, end: text.length, quote: text }] });
  const input = { scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: source.operationId, kind: 'main' as const, sources: [source] };
  const factModel = vi.fn(async () => ({ kind: 'extracted' as const, candidates: [candidate], attempts: 1 }));
  const deps = { repo, factModel, rulePolicy: { ruleVersion: 'test', storyNodes: [] } };
  return { repo, seed, source, candidate, input, deps };
}
describe('core2 settlement transaction coordinator', () => {
  it('commits state, events, knowledge, source position, receipt and pending summary atomically', async () => {
    const { repo, seed, input, deps } = await setup();
    const result = await settleCoreOperation(input, deps);
    expect(result.status).toBe('committed');
    const state = await repo.readState(seed.head.scope);
    expect(state.records.find(r => r.entityId === 'apple')?.value).toMatchObject({ quantity: 3 });
    expect((await repo.queryEvents({ scope: input.scope, cutoffSeq: 1 })).items.some(e => e.fact?.kind === 'inventory')).toBe(true);
    expect((await repo.queryKnowledge({ scope: input.scope, cutoffSeq: 1, npcIds: ['npc-amber'] })).items.length).toBeGreaterThan(0);
    expect((await repo.queryJobs({ scope: input.scope, cutoffSeq: 1 })).items).toMatchObject([{ kind: 'turn_summary', status: 'pending' }]);
    expect(await recoverCoreOperation(repo, input.scope, input.operationId)).toMatchObject({ kind: 'committed', receipt: result });
    expect((await settleCoreOperation(input, deps)).status).toBe('already_committed');
    expect(deps.factModel).toHaveBeenCalledTimes(1);
  });
  it('keeps source and staged facts after an uncertain commit response and recovers without calling a model', async () => {
    const { repo, input, deps } = await setup();
    const commit = repo.commit.bind(repo);
    vi.spyOn(repo, 'commit').mockImplementationOnce(async batch => { await commit(batch); throw Error('response lost'); });
    await expect(settleCoreOperation(input, deps)).rejects.toThrow('response lost');
    expect(await recoverCoreOperation(repo, input.scope, input.operationId)).toMatchObject({ kind: 'committed' });
    expect((await settleCoreOperation(input, deps)).status).toBe('already_committed');
    expect(deps.factModel).toHaveBeenCalledTimes(1);
  });
  it('does not commit an old session after a takeover while the model is waiting', async () => {
    const { repo, input, deps } = await setup();
    const original = deps.factModel;
    deps.factModel = vi.fn(async () => {
      const nextSession = 'new-session'; await repo.activateSession(input.scope, nextSession);
      return original();
    });
    expect((await settleCoreOperation(input, deps)).status).toBe('cancelled');
    expect((await repo.readState(input.scope)).head.coreSeq).toBe(0);
    expect((await repo.queryEvents({ scope: input.scope, cutoffSeq: 0 })).items).toEqual([]);
  });
  it('rejects a related inventory edit while preserving the edit and the staged response', async () => {
    const { repo, seed, input, deps } = await setup(); const original = deps.factModel;
    deps.factModel = vi.fn(async () => { const batch = makeBatch(seed); await prepareBatch(repo, batch); await repo.commit(batch); return original(); });
    expect(await settleCoreOperation(input, deps)).toMatchObject({ status: 'conflict', reason: 'state_read_version_changed' });
    expect((await repo.readState(input.scope)).records.find(r => r.entityId === 'apple')?.value).toMatchObject({ quantity: 2 });
    expect((await recoverCoreOperation(repo, input.scope, input.operationId)).kind).toBe('needs_review');
  });
  it('preserves a concurrent unrelated memory append instead of rejecting or replacing it', async () => {
    const { repo, seed, input, deps } = await setup();
    const batch = makeBatch(seed); await prepareBatch(repo, batch); await repo.commit(batch);
    const original = deps.factModel;
    deps.factModel = vi.fn(async () => {
      await repo.claimJob({ scope: input.scope, sessionId: input.sessionId, jobId: batch.jobs[0]!.jobId, leaseId: 'memory-lease', sourceRefs: batch.sourceRefs, expectedVersion: 1 });
      const memory = makeMemory({ scope: input.scope, sourceRefs: batch.sourceRefs, eventIds: [batch.events[0]!.eventId], momentRange: { start: batch.events[0]!.occurredMoment, end: batch.events[0]!.occurredMoment, sourceIds: batch.sourceRefs.map(ref => ref.sourceId) } });
      expect((await repo.publishDerived({ scope: input.scope, sessionId: input.sessionId, jobId: batch.jobs[0]!.jobId, leaseId: 'memory-lease', sourceRefs: batch.sourceRefs, readSet: [], expectedMemoryRevision: 0, additions: [memory], supersededIds: [] })).status).toBe('published');
      return original();
    });
    expect((await settleCoreOperation(input, deps)).status).toBe('committed');
    expect(await repo.readHead(input.scope)).toMatchObject({ coreSeq: 2, memoryRevision: 1 });
    expect((await repo.queryMemories({ scope: input.scope, cutoffSeq: 2, memoryRevision: 1 })).items).toHaveLength(1);
  });
  it('retains failed extraction sources for explicit retry and does not pretend empty facts succeeded', async () => {
    const { repo, input, deps, source } = await setup();
    const failed = { ...deps, factModel: vi.fn(async () => ({ kind: 'failed' as const, code: 'MODEL_EMPTY', detail: 'empty', attempts: 1 })) };
    await expect(settleCoreOperation(input, failed)).rejects.toThrow('MODEL_EMPTY');
    expect(await repo.readSource(source.ref)).toEqual(source);
    expect(await recoverCoreOperation(repo, input.scope, input.operationId)).toMatchObject({ kind: 'needs_extraction' });
    expect(await repo.readOperation(input.scope, input.operationId)).toMatchObject({ status: 'failed', failure: { code: 'MODEL_EMPTY', detail: 'empty' } });
    expect((await repo.readHead(input.scope)).coreSeq).toBe(0);
  });
  it('folds multiple touches of the same inventory record but retains each confirmed action for auditing', async () => {
    const { repo, input, deps, candidate } = await setup('安柏把两枚苹果放入玩家背包。安柏又把两枚苹果放入玩家背包。');
    const end = '安柏把两枚苹果放入玩家背包。'.length;
    const first = structuredClone(candidate); first.evidenceRefs[0]!.end = end; first.evidenceRefs[0]!.quote = '安柏把两枚苹果放入玩家背包。';
    const second = structuredClone(candidate); second.candidateId = 'second'; second.evidenceRefs[0]!.start = end; second.evidenceRefs[0]!.quote = '安柏又把两枚苹果放入玩家背包。';
    const result = await settleCoreOperation(input, { ...deps, factModel: async () => ({ kind: 'extracted', candidates: [second, first], attempts: 1 }) });
    expect(result.status).toBe('committed');
    expect((await repo.readState(input.scope)).records.find(r => r.entityId === 'apple')).toMatchObject({ version: 2, value: { quantity: 5 } });
    const events = (await repo.queryEvents({ scope: input.scope, cutoffSeq: 1 })).items;
    expect(events.filter(e => e.fact?.kind === 'inventory')).toHaveLength(2);
    expect(events.flatMap(e => e.committedChanges).filter(c => c.ref.entityId === 'apple')).toHaveLength(1);
  });
  it('persists a rule-pending reason and does not turn a failed group into knowledge or inventory changes', async () => {
    const { repo, input, deps, candidate } = await setup('玩家交给安柏十二枚苹果。');
    candidate.proposal = { kind: 'inventory', action: 'give', itemId: 'apple', quantity: 12, recipientId: 'npc-amber' };
    const result = await settleCoreOperation(input, deps);
    expect(result.status).toBe('committed');
    const operation = await repo.readOperation(input.scope, input.operationId);
    expect(operation?.stage?.review).toMatchObject([{ status: 'pending', reason: expect.stringContaining('库存') }]);
    expect((await repo.readState(input.scope)).records.find(r => r.entityId === 'apple')?.value).toMatchObject({ quantity: 1 });
  });
  it('keeps the committed receipt when cancellation arrives after the database has saved it', async () => {
    const { repo, input, deps } = await setup(); const controller = new AbortController();
    const commit = repo.commit.bind(repo);
    vi.spyOn(repo, 'commit').mockImplementationOnce(async batch => { const receipt = await commit(batch); controller.abort(); return receipt; });
    expect((await settleCoreOperation({ ...input, signal: controller.signal }, deps)).status).toBe('committed');
    expect((await repo.readHead(input.scope)).coreSeq).toBe(1);
  });
  it.each(['readState', 'putSource', 'prepareOperation', 'stageOperation', 'queryCommitments'] as const)('returns a cancelled outcome when aborted immediately after %s resolves', async method => {
    const { repo, input, deps } = await setup(); const controller = new AbortController();
    const original = repo[method].bind(repo) as (...args: unknown[]) => Promise<unknown>;
    vi.spyOn(repo, method).mockImplementationOnce((async (...args: unknown[]) => { const result = await original(...args); controller.abort(); return result; }) as never);
    expect((await settleCoreOperation({ ...input, signal: controller.signal }, deps)).status).toBe('cancelled');
    expect((await repo.readHead(input.scope)).coreSeq).toBe(0);
    expect((await repo.readOperation(input.scope, input.operationId))?.status).toBe('cancelled');
  });
});
