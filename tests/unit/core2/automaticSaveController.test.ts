import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { makeSeed } from './fixtures';
import type { FactExtractionInput, FactExtractionResult } from '@/core/settlement/factExtraction';

async function fixture() {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-automatic-controller-${crypto.randomUUID()}` }), seed = makeSeed();
  const generateNarrative = vi.fn(async () => JSON.stringify({ body: [{ kind: 'dialogue', speaker: '安柏', text: '今天也一起出发吧。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }));
  const factModel = vi.fn(async (_input: FactExtractionInput): Promise<FactExtractionResult> => ({ kind: 'extracted', candidates: [], attempts: 0 }));
  const controller = createCoreController({ repo, turnDependencies: () => ({ generateNarrative, factModel, assembleContext: async () => ({ systemPrompt: '', messages: [] }), rulePolicy: { ruleVersion: 'test', storyNodes: [] } }) });
  await controller.initialize(seed);
  const send = (turn: number) => controller.send({ scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: `auto-turn-${turn}`, text: '出发' });
  return { repo, seed, controller, send, generateNarrative, factModel };
}
it('does not create or hash a checkpoint before any main turn has completed', async () => {
  const f = await fixture(), uuid = vi.spyOn(crypto, 'randomUUID');
  try { expect(await f.controller.saveAutomatic()).toBeNull(); expect(uuid).not.toHaveBeenCalled(); }
  finally { uuid.mockRestore(); }
});
it('actually autosaves completed main turns, retaining ten visible nodes and their exact turn states', async () => {
  const f = await fixture();
  for (let turn = 1; turn <= 11; turn++) { expect((await f.send(turn)).kind).toBe('committed'); await f.controller.waitForBackground(); }
  const slots = (await f.repo.listSaveSlots(f.seed.head.scope.journeyId)).filter(row => row.kind === 'auto');
  expect(slots.map(row => row.turn).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  for (const slot of slots) {
    const saved = await f.repo.readSnapshot(slot.snapshotId);
    expect(saved?.state.records.find(row => row.domain === 'world')).toMatchObject({ value: { completedMainTurns: slot.turn } });
  }
  expect(f.controller.getView().slots.filter(row => row.kind === 'auto')).toHaveLength(10);
  expect(f.controller.getView().lastSaved).toBeNull();
});
it('reports autosave failure separately from committed gameplay and retries saving without regenerating a turn', async () => {
  const f = await fixture(), publish = f.repo.publishSnapshot.bind(f.repo);
  vi.spyOn(f.repo, 'publishSnapshot').mockRejectedValueOnce(Error('TEST_DISK_FULL'));
  expect((await f.send(1)).kind).toBe('committed'); await f.controller.waitForBackground();
  expect(f.controller.getView().autoSaveError).toContain('TEST_DISK_FULL');
  expect(f.controller.getView().result?.kind).toBe('committed');
  vi.mocked(f.repo.publishSnapshot).mockImplementation(publish);
  await f.controller.saveAutomatic();
  expect(f.controller.getView().autoSaveError).toBeNull();
  expect((await f.repo.listSaveSlots(f.seed.head.scope.journeyId)).filter(row => row.kind === 'auto')).toHaveLength(1);
  expect(f.generateNarrative).toHaveBeenCalledTimes(1); expect(f.factModel).toHaveBeenCalledTimes(1);
});
it('rechecks a changed snapshot head without mislabelling a later state as an earlier turn', async () => {
  const f = await fixture(), publish = f.repo.publishSnapshot.bind(f.repo);
  vi.spyOn(f.repo, 'publishSnapshot').mockRejectedValueOnce(Error('CORE2_SNAPSHOT_HEAD_CHANGED')).mockImplementation(publish);
  expect((await f.send(1)).kind).toBe('committed'); await f.controller.waitForBackground();
  expect(f.controller.getView().autoSaveError).toBeNull();
  expect((await f.repo.listSaveSlots(f.seed.head.scope.journeyId)).filter(row => row.kind === 'auto').map(row => row.turn)).toEqual([1]);
});
it('also saves and summarizes a committed turn whose ambiguous fact still awaits player review', async () => {
  const f = await fixture();
  f.factModel.mockImplementation(async input => ({ kind: 'extracted', attempts: 0, candidates: [{ candidateId: 'pending-item', scope: f.seed.head.scope, operationId: input.source.operationId, kind: 'inventory',
    actors: [], targets: [], proposal: { kind: 'inventory', action: 'gain', itemId: 'unregistered-sword', quantity: 1 }, evidenceRefs: [{ ref: input.source.ref, blockId: 'body-1', start: 0, end: input.source.blocks[0]!.text.length, quote: input.source.blocks[0]!.text }], status: 'proposed' }] }));
  const result = await f.send(1); expect(result.kind).toBe('pending'); await f.controller.waitForBackground();
  expect((await f.repo.listSaveSlots(f.seed.head.scope.journeyId)).filter(row => row.kind === 'auto')).toHaveLength(1);
  expect((await f.repo.readHead(f.seed.head.scope)).memoryRevision).toBe(1);
});
