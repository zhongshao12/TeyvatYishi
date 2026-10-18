import { expect, it, vi } from 'vitest';
import { planMemoryMaintenance, runMemoryMaintenance } from '@/core/memory/maintenance';
import type { MemoryRecord } from '@/core/contracts/memory';
import { makeMemoryMaintenanceFixture as fixture } from './memoryMaintenanceFixture';
import { editCoreMemory } from '@/core/memory/manualEdits';

it('publishes all selected replacements at once, while keeping original sources and old memory versions', async () => {
  const { repo, seed, memories, input } = await fixture();
  const summarize = vi.fn(async () => ({ kind: 'model' as const, text: '三次平静的问候。' }));
  expect((await runMemoryMaintenance(planMemoryMaintenance(input), { repo, summarize })).kind).toBe('completed');
  const head = await repo.readHead(seed.head.scope), active = (await repo.queryMemories({ scope: seed.head.scope, cutoffSeq: head.coreSeq, memoryRevision: head.memoryRevision, statuses: ['active'] })).items;
  expect(active).toHaveLength(1); expect(active[0]?.layer).toBe('middle'); expect(active[0]?.turns).toEqual([1, 2, 3]);
  expect(active[0]?.memoryRefs).toHaveLength(3); expect(summarize).toHaveBeenCalledTimes(1);
  for (const memory of memories) for (const ref of memory.sourceRefs) expect(await repo.readSource(ref)).not.toBeNull();
  expect((await repo.queryMemories({ scope: seed.head.scope, cutoffSeq: 3, memoryRevision: 3, statuses: ['active'] })).items).toHaveLength(3);
});
it('keeps the active collection unchanged on model failure or cancellation', async () => {
  const { repo, seed, memories, input } = await fixture();
  const summarize = vi.fn(async () => ({ kind: 'failed' as const, code: 'timeout', detail: '模型超时' }));
  expect((await runMemoryMaintenance(planMemoryMaintenance(input), { repo, summarize })).kind).toBe('failed');
  expect((await repo.readHead(seed.head.scope)).memoryRevision).toBe(3);
  expect((await repo.queryMemories({ scope: seed.head.scope, cutoffSeq: 3, memoryRevision: 3, statuses: ['active'] })).items).toEqual(memories);
  const abort = new AbortController();
  const cancel = vi.fn(async () => { abort.abort(); return { kind: 'model' as const, text: '迟到摘要' }; });
  expect((await runMemoryMaintenance(planMemoryMaintenance({ ...input, jobId: 'cancelled-maintenance' }), { repo, summarize: cancel, signal: abort.signal })).kind).toBe('cancelled');
  expect((await repo.readHead(seed.head.scope)).memoryRevision).toBe(3);
});
it('only rebuilds selected complete turns and preserves cross-range, pinned and edited records', async () => {
  const { input, memories } = await fixture();
  const selected = memories.find(memory => memory.turns[0] === 2)!;
  const cross: MemoryRecord = { ...memories.find(memory => memory.turns[0] === 1)!, memoryId: 'cross-range', turns: [1, 2] };
  const edited: MemoryRecord = { ...selected, memoryId: 'edited', editVersion: 1 };
  const plan = planMemoryMaintenance({ ...input, mode: 'rebuild', selectedTurns: [2], memories: [...memories, cross, edited] });
  expect(plan.steps.map(step => step.operationId)).toEqual(['turn-2']);
  expect(plan.supersededIds).toEqual([selected.memoryId]);
});
it('actually rebuilds turn 2 without changing turns 1 and 3', async () => {
  const { repo, seed, input, memories } = await fixture();
  const outside = memories.filter(memory => memory.turns[0] !== 2);
  const plan = planMemoryMaintenance({ ...input, mode: 'rebuild', selectedTurns: [2], settings: { ...input.settings, mode: 'local' } });
  expect((await runMemoryMaintenance(plan, { repo })).kind).toBe('completed');
  const head = await repo.readHead(seed.head.scope), active = (await repo.queryMemories({ scope: seed.head.scope, cutoffSeq: head.coreSeq, memoryRevision: head.memoryRevision, statuses: ['active'] })).items;
  for (const memory of outside) expect(active.find(row => row.memoryId === memory.memoryId)).toEqual(memory);
  expect(active.filter(memory => memory.turns[0] === 2)).toHaveLength(1);
});
it('stages every selected turn before publishing, then retries only the failed and remaining steps', async () => {
  const { repo, seed, input } = await fixture(); let fail = true;
  const summarize = vi.fn(async ({ turn }: { turn: number }) => turn === 2 && fail ? { kind: 'failed' as const, code: 'timeout', detail: '第二步失败' } : { kind: 'model' as const, text: `第 ${turn} 回合摘要。` });
  const plan = planMemoryMaintenance({ ...input, mode: 'rebuild', selectedTurns: [1, 2, 3] });
  expect((await runMemoryMaintenance(plan, { repo, summarize })).kind).toBe('failed');
  expect((await repo.readHead(seed.head.scope)).memoryRevision).toBe(3);
  fail = false;
  expect((await runMemoryMaintenance(plan, { repo, summarize })).kind).toBe('completed');
  expect(summarize.mock.calls.map(call => call[0].turn)).toEqual([1, 2, 2, 3]);
  expect((await repo.readHead(seed.head.scope)).memoryRevision).toBe(4);
});
it('reuses a stopped job’s successful material only for the exact same selected sources and rules', async () => {
  const { repo, seed, input } = await fixture(), abort = new AbortController();
  const first = vi.fn(async ({ turn }: { turn: number }) => { if (turn === 2) abort.abort(); return { kind: 'model' as const, text: `第 ${turn} 回合摘要。` }; });
  const plan = planMemoryMaintenance({ ...input, mode: 'rebuild', selectedTurns: [1, 2, 3] });
  expect((await runMemoryMaintenance(plan, { repo, summarize: first, signal: abort.signal })).kind).toBe('cancelled');
  const summarize = vi.fn(async ({ turn }: { turn: number }) => ({ kind: 'model' as const, text: `第 ${turn} 回合摘要。` }));
  const resumed = { ...plan, jobId: 'replacement-job', reuseJobId: plan.jobId };
  expect((await runMemoryMaintenance(resumed, { repo, summarize })).kind).toBe('completed');
  expect(summarize.mock.calls.map(call => call[0].turn)).toEqual([2, 3]);
  expect((await repo.readHead(seed.head.scope)).coreSeq).toBe(3);
});
it('does not overwrite a related manual edit made while the model was waiting', async () => {
  const { repo, seed, input, memories } = await fixture(), selected = memories[0]!;
  const summarize = vi.fn(async () => {
    await editCoreMemory(repo, { scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: 'concurrent-edit', jobId: 'concurrent-edit-job', memoryId: selected.memoryId, expectedVersion: 1, text: '等待期间玩家修改的记忆。' }, { rulePolicy: { ruleVersion: 'test', storyNodes: [] } });
    return { kind: 'model' as const, text: '旧材料整理结果' };
  });
  expect((await runMemoryMaintenance(planMemoryMaintenance(input), { repo, summarize })).kind).not.toBe('completed');
  const head = await repo.readHead(seed.head.scope), active = (await repo.queryMemories({ scope: seed.head.scope, cutoffSeq: head.coreSeq, memoryRevision: head.memoryRevision, statuses: ['active'] })).items;
  expect(active).toHaveLength(3); expect(active.find(memory => memory.memoryId === selected.memoryId)?.text).toBe('等待期间玩家修改的记忆。');
  expect(active.some(memory => memory.text === '旧材料整理结果')).toBe(false);
});
it('does not call the model for a preview whose selected memory was edited before confirmation', async () => {
  const { repo, seed, input, memories } = await fixture(), plan = planMemoryMaintenance(input), selected = memories[0]!;
  await editCoreMemory(repo, { scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: 'edit-before-confirm', jobId: 'edit-before-confirm-job', memoryId: selected.memoryId, expectedVersion: 1, text: '玩家在预览后修正了经历。' }, { rulePolicy: { ruleVersion: 'test', storyNodes: [] } });
  const summarize = vi.fn(async () => ({ kind: 'model' as const, text: '不应花费这次请求' }));
  expect((await runMemoryMaintenance(plan, { repo, summarize })).kind).toBe('failed');
  expect(summarize).not.toHaveBeenCalled();
  const head = await repo.readHead(seed.head.scope), job = (await repo.queryJobs({ scope: seed.head.scope, cutoffSeq: head.coreSeq, jobIds: [plan.jobId] })).items[0]!;
  expect(job).toMatchObject({ status: 'failed', failure: { detail: expect.stringContaining('重新预览') } });
});
it('merges a genuinely unrelated append without discarding it or rejecting unchanged selected versions', async () => {
  const { repo, seed, input, memories } = await fixture(), original = memories[0]!;
  const summarize = vi.fn(async () => {
    const jobId = 'unrelated-append-job', leaseId = 'unrelated-append-lease';
    await repo.enqueueJob({ jobId, scope: input.scope, sessionId: input.sessionId, kind: 'profile', operationId: input.anchorOperationId, sourceRefs: original.sourceRefs, status: 'pending', leaseId: null, configFingerprint: 'unrelated-test', attempts: 0, steps: [], version: 1 });
    const claimed = await repo.claimJob({ jobId, scope: input.scope, sessionId: input.sessionId, sourceRefs: original.sourceRefs, leaseId, expectedVersion: 1 });
    await repo.publishDerived({ jobId, scope: input.scope, sessionId: input.sessionId, sourceRefs: original.sourceRefs, leaseId, expectedMemoryRevision: 3, readSet: [], additions: [{ ...original, memoryId: 'unrelated-memory' }], supersededIds: [] });
    await repo.finishJob({ jobId, scope: input.scope, sessionId: input.sessionId, sourceRefs: original.sourceRefs, leaseId, expectedVersion: claimed!.version, status: 'completed' });
    return { kind: 'model' as const, text: '整理后的三回合摘要' };
  });
  expect((await runMemoryMaintenance(planMemoryMaintenance(input), { repo, summarize })).kind).toBe('completed');
  const head = await repo.readHead(seed.head.scope), active = (await repo.queryMemories({ scope: seed.head.scope, cutoffSeq: head.coreSeq, memoryRevision: head.memoryRevision, statuses: ['active'] })).items;
  expect(active).toHaveLength(2); expect(active.find(memory => memory.memoryId === 'unrelated-memory')).toEqual({ ...original, memoryId: 'unrelated-memory' });
  expect(head.coreSeq).toBe(3); expect(head.memoryRevision).toBe(5);
});
