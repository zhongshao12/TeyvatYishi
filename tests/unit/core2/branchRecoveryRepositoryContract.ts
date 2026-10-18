import { expect, it, vi } from 'vitest';
import { restoreBranch, forkFromSnapshot, recoverCurrentBranch } from '@/core/persistence/branchRecovery';
import { saveSlot } from '@/core/persistence/saveSlots';
import { makeSeed } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';
import { nextBatch } from './snapshotRepositoryContract';

export function assertBranchRecoveryRepositoryContract(factory: () => Promise<import('@/core/contracts/storage').CoreRepository>): void {
it('filters committed operation kinds before descending pagination, including clipped ancestors', async () => {
  const repo = await factory(), seed = makeSeed(); await repo.initialize(seed);
  const first = makeBatch(seed); await prepareBatch(repo, first); await repo.commit(first);
  const slot = await saveSlot(repo, { scope: seed.head.scope, kind: 'manual', asNew: true, turn: 1, name: '云' });
  const child = await repo.fork({ parentScope: seed.head.scope, snapshotId: slot.snapshotId, branchId: 'history-child', sessionId: 'history-child-session' });
  const second = await nextBatch(repo, child.scope); await prepareBatch(repo, second); await repo.commit(second);
  const query = { scope: child.scope, cutoffSeq: 2, afterSeq: 0, kinds: ['main' as const], direction: 'desc' as const, limit: 1 };
  const latest = await repo.queryCommittedOperations(query);
  expect(latest.items.map(row => row.operationId)).toEqual([second.operationId]); expect(latest.nextCursor).toBeTruthy();
  expect((await repo.queryCommittedOperations({ ...query, cursor: latest.nextCursor })).items.map(row => row.operationId)).toEqual([first.operationId]);
  expect((await repo.queryCommittedOperations({ ...query, kinds: ['manual'] })).items).toEqual([]);
});
async function scenario() {
  const repo = await factory();
  const seed = makeSeed(); await repo.initialize(seed);
  const batch = makeBatch(seed); await prepareBatch(repo,batch); await repo.commit(batch);
  const slot = await saveSlot(repo, { scope:seed.head.scope,kind:'manual',asNew:true,turn:1,name:'云' });
  return { repo,seed,batch,slot };
}
it('restoring the original node after overwriting its slot returns its own state, not a later parent state', async () => {
  const { repo,seed,slot } = await scenario(); const original = await repo.readSnapshot(slot.snapshotId);
  const batch = await nextBatch(repo,seed.head.scope); await prepareBatch(repo,batch); await repo.commit(batch);
  await saveSlot(repo,{ scope:seed.head.scope,kind:'manual',asNew:false,currentSlotId:slot.slotId,turn:1,name:'云' });
  const before = await repo.readState(seed.head.scope);
  expect(await restoreBranch(repo,slot.snapshotId)).toEqual(original!.state);
  expect(await repo.readState(seed.head.scope)).toEqual(before);
});
it('continuing the old node forks with both fixed positions and does not change the original branch', async () => {
  const { repo,seed,slot } = await scenario(); const before = await repo.readState(seed.head.scope);
  const child = await forkFromSnapshot(repo,{ snapshotId:slot.snapshotId,parentScope:seed.head.scope,branchId:'continued',sessionId:'continued-session' });
  expect(child).toMatchObject({ coreSeq:1,memoryRevision:0,forkSeq:1,forkMemoryRevision:0 });
  expect(await repo.readState(seed.head.scope)).toEqual(before);
  expect((await repo.readState(child.scope)).records.every(record=>record.scope.branchId==='continued')).toBe(true);
});
it('a missing baseline fails explicitly rather than manufacturing an empty playable state', async () => {
  const { repo } = await scenario();
  await expect(restoreBranch(repo,'missing-snapshot')).rejects.toThrow('CORE2_SNAPSHOT_NOT_FOUND');
});
it('replays the saved deterministic result after the latest checkpoint without running a model', async () => {
  const repo = await factory();
  const seed=makeSeed(); await repo.initialize(seed);
  const first=makeBatch(seed); await prepareBatch(repo,first); await repo.commit(first);
  const second=await nextBatch(repo,seed.head.scope); await prepareBatch(repo,second); await repo.commit(second);
  const before=await repo.readState(seed.head.scope);
  expect(await recoverCurrentBranch(repo,seed.head.scope)).toEqual(before);
  expect(await repo.readState(seed.head.scope)).toEqual(before);
});
it('a committed operation with no events still counts as a verified replay position', async () => {
  const repo=await factory();
  const seed=makeSeed(); await repo.initialize(seed); const batch=makeBatch(seed);
  batch.readSet=[]; batch.changes=[]; batch.events=[]; batch.knowledge=[]; batch.commitments=[]; batch.jobs=[];
  await prepareBatch(repo,batch); expect((await repo.commit(batch)).status).toBe('committed');
  expect(await recoverCurrentBranch(repo,seed.head.scope)).toEqual(await repo.readState(seed.head.scope));
});
it('a takeover during replay is rejected instead of returning a stale head', async () => {
  const repo=await factory();
  const seed=makeSeed(); await repo.initialize(seed); const batch=makeBatch(seed); await prepareBatch(repo,batch); await repo.commit(batch);
  const read=repo.queryCommittedOperations.bind(repo);
  const wrapped={...repo,async queryCommittedOperations(query:Parameters<typeof read>[0]) {
    const page=await read(query); await repo.activateSession(seed.head.scope,'replacement-session'); return page;
  }};
  await expect(recoverCurrentBranch(wrapped,seed.head.scope)).rejects.toThrow('CORE2_RECOVERY_HEAD_CHANGED');
});
it('missing operation evidence is not treated as an empty successful turn', async () => {
  const repo=await factory();
  const seed=makeSeed(); await repo.initialize(seed); const batch=makeBatch(seed); await prepareBatch(repo,batch); await repo.commit(batch);
  await expect(recoverCurrentBranch({...repo,async queryCommittedOperations(){return {items:[]};}},seed.head.scope)).rejects.toThrow('CORE2_RECOVERY_COMMIT_GAP');
});
it('a stale checkpoint more than 49 commits behind is rejected before loading replay data', async () => {
  const repo=await factory();
  const seed=makeSeed(); await repo.initialize(seed); const original=await repo.readRecoveryCheckpoint(seed.head.scope);
  const query=vi.fn(repo.queryCommittedOperations.bind(repo));
  // The 200-commit contract proves durable boundaries; this case injects bad head metadata
  // to prove rejection happens BEFORE loading or replaying any history.
  await expect(recoverCurrentBranch({...repo,async readHead(){return {...seed.head,coreSeq:50};},async readRecoveryCheckpoint(){return original;},queryCommittedOperations:query},seed.head.scope)).rejects.toThrow('CORE2_RECOVERY_REPLAY_LIMIT');
  expect(query).not.toHaveBeenCalled();
});
}
