import { expect, it } from 'vitest';
import { saveSlot } from '@/core/persistence/saveSlots';
import { makeSeed } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';
import { nextBatch } from './snapshotRepositoryContract';

export function assertSaveSlotsRepositoryContract(factory: () => Promise<import('@/core/contracts/storage').CoreRepository>): void {
it('save updates the current manual slot, save-as adds a slot, and the old immutable node survives', async () => {
  const repo = await factory(); const seed = makeSeed(); await repo.initialize(seed);
  const request = { scope: seed.head.scope, kind: 'manual' as const, asNew: true, turn: 1, name: '云的旅程' };
  const original = await saveSlot(repo, request); const old = await repo.readSnapshot(original.snapshotId);
  const batch = makeBatch(seed); await prepareBatch(repo, batch); await repo.commit(batch);
  const updated = await saveSlot(repo, { ...request, asNew: false, currentSlotId: original.slotId });
  expect(updated.slotId).toBe(original.slotId); expect(updated.snapshotId).not.toBe(original.snapshotId);
  expect(await repo.readSnapshot(original.snapshotId)).toEqual(old);
  expect(await repo.listSaveSlots(seed.head.scope.journeyId)).toHaveLength(1);
  const separate = await saveSlot(repo, { ...request, currentSlotId: original.slotId, asNew: true });
  expect(separate.slotId).not.toBe(original.slotId); expect(await repo.listSaveSlots(seed.head.scope.journeyId)).toHaveLength(2);
});
it('the eleventh main-turn autosave reuses a visible slot but does not delete the first snapshot', async () => {
  const repo = await factory(); const seed = makeSeed(); await repo.initialize(seed);
  let firstSnapshot = '';
  for (let turn = 1; turn <= 11; turn++) {
    const batch = turn === 1 ? makeBatch(seed) : await nextBatch(repo, seed.head.scope);
    await prepareBatch(repo, batch); await repo.commit(batch);
    const saved = await saveSlot(repo, { scope: seed.head.scope, kind: 'auto', asNew: false, turn, name: `回合${turn}` });
    if (turn === 1) firstSnapshot = saved.snapshotId;
  }
  const slots = await repo.listSaveSlots(seed.head.scope.journeyId);
  expect(slots.filter(row => row.kind === 'auto').map(row => row.turn).sort((a,b) => a-b)).toEqual([2,3,4,5,6,7,8,9,10,11]);
  expect(await repo.readSnapshot(firstSnapshot)).not.toBeNull();
});
it('more phone commits in the same explicit main turn update one autosave rather than inventing turns', async () => {
  const repo = await factory(); const seed = makeSeed(); await repo.initialize(seed);
  const first = await saveSlot(repo, { scope: seed.head.scope, kind: 'auto', asNew: false, turn: 1, name: '回合1' });
  const batch = makeBatch(seed); await prepareBatch(repo, batch); await repo.commit(batch);
  const second = await saveSlot(repo, { scope: seed.head.scope, kind: 'auto', asNew: false, turn: 1, name: '回合1' });
  expect(second.slotId).toBe(first.slotId); expect(second.snapshotId).not.toBe(first.snapshotId);
  expect(await repo.listSaveSlots(seed.head.scope.journeyId)).toHaveLength(1);
});
it('two overlapping first autosaves for the same main turn do not create duplicate visible nodes',async()=>{
  const repo=await factory(); const seed=makeSeed(); await repo.initialize(seed);
  const request={scope:seed.head.scope,kind:'auto' as const,asNew:false,turn:1,name:'回合1'};
  const [first,second]=await Promise.all([saveSlot(repo,request),saveSlot(repo,request)]);
  expect(first.slotId).toBe(second.slotId);
  expect(await repo.listSaveSlots(seed.head.scope.journeyId)).toHaveLength(1);
});
}
