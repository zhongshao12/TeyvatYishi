import { expect, it } from 'vitest';
import { retrieveCoreMemories } from '@/core/retrieval/retrieveMemory';
import { assembleCoreMemoryContext } from '@/core/retrieval/assembleMemoryContext';
import { recallFixture } from './recallFixture';
import { makeBatch, prepareBatch } from './repositoryContract';
import { makeSeed } from './fixtures';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';

it('preserves protected memories over an optional budget, with visible overflow and no input mutation', async () => {
  const f = await recallFixture(1); await f.publish({ memoryId: 'pinned', pinned: true, text: '答应陪安柏看蒲公英，不可遗忘的共同经历。' });
  const input = { ...await f.request(), optionalTokenBudget: 1 }, original = structuredClone(input);
  const result = await retrieveCoreMemories(input, { repo: f.repo }), context = assembleCoreMemoryContext(result, input);
  expect(result.mandatory.map(row => row.memoryId)).toContain('pinned');
  expect(context.budgetOverflow).toBe(true); expect(context.mandatoryText).toContain('共同经历'); expect(input).toEqual(original);
  expect(context.bundleId).toBe(result.bundleId); expect(context.estimatedTokens).toBeGreaterThan(1);
});

it('selects due commitments separately without re-reminding fulfilled ones or granting knowledge', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-due-${crypto.randomUUID()}` }), seed = makeSeed(); await repo.initialize(seed);
  const batch = makeBatch(seed), active = batch.commitments[0]!;
  batch.jobs = []; batch.commitments.push({ ...structuredClone(active), commitmentId: 'already-fulfilled', status: 'fulfilled', text: '已经吃过苹果。' });
  await prepareBatch(repo, batch); expect((await repo.commit(batch)).status).toBe('committed');
  const request = { scope: seed.head.scope, head: await repo.readHead(seed.head.scope), audience: { target: 'private' as const, npcIds: ['npc-amber'] }, entityIds: [], locations: [], query: '', moment: { ...seed.sources[0]!.moment, date: '旅行历 1000.03.08' } };
  const result = await retrieveCoreMemories(request, { repo });
  expect(result.mandatory.map(row => row.eventId)).toContain(active.establishedEventId);
  expect(result.mandatory.map(row => row.commitmentId)).toEqual(['promise-apple']);
  const stranger = await retrieveCoreMemories({ ...request, audience: { target: 'private', npcIds: ['npc-lisa'] } }, { repo });
  expect(stranger.mandatory).toEqual([]);
});

it('reports actual selected leaves after optional budget exclusion and binds assembly to its audience', async () => {
  const f = await recallFixture(), input = await f.request(), result = await retrieveCoreMemories(input, { repo: f.repo });
  const context = assembleCoreMemoryContext(result, { ...input, optionalTokenBudget: 0 });
  expect(context.optionalText).toBe(''); expect(context.selectedLeafIds).toEqual([]);
  expect(context.diagnostics.some(row => row.reason === 'optional_budget_excluded')).toBe(true);
  expect(() => assembleCoreMemoryContext(result, { ...input, audience: { target: 'news', npcIds: [] } })).toThrow('CORE2_RECALL_BUNDLE_MISMATCH');
});
