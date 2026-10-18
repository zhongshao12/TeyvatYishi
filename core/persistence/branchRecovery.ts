import type { CoreRepository, ForkRequest } from '../contracts/storage';
import type { CoreSnapshot, StateRecord } from '../contracts/state';
import type { BranchHead, CoreScope, RecordRef } from '../contracts/identity';
import type { GameEvent } from '../contracts/event';
import { assertId, ownDto, stableJson, sameScope, sameData, refKey, compareCoreIds } from './repositoryValidation';
import { checksumUtf8 } from '../sources/sourceIntegrity';

/** An explicit old node is not the live parent's latest projection. Never call a model here. */
export async function restoreBranch(repo: CoreRepository, snapshotId: string): Promise<CoreSnapshot> {
  assertId(snapshotId);
  const value = await repo.readSnapshot(snapshotId);
  if (!value) throw new Error('CORE2_SNAPSHOT_NOT_FOUND');
  const snapshot = ownDto('snapshotRecord', value);
  if (snapshot.snapshotId !== snapshotId || snapshot.checksum !== checksumUtf8(stableJson(snapshot.state))) throw new Error('CORE2_SNAPSHOT_CHECKSUM_MISMATCH');
  return snapshot.state;
}

/** Fork publication retains the native/IDB atomicity and double-cutoff checks. */
export async function forkFromSnapshot(repo: CoreRepository, input: ForkRequest): Promise<BranchHead> {
  const request = ownDto('fork', input);
  return ownDto('head', await repo.fork(request));
}

export const MAX_CORE_REPLAY = 49;
/** Replays durable effects only. An empty successful operation is not a missing commit. */
export async function recoverCurrentBranch(repo: CoreRepository,input: CoreScope): Promise<CoreSnapshot> {
  const scope=ownDto('scope',input), head=ownDto('head',await repo.readHead(scope));
  const checkpoint=ownDto('snapshotRecord',await repo.readRecoveryCheckpoint(scope));
  if (!sameScope(head.scope,scope) || !sameScope(checkpoint.scope,scope) || checkpoint.checksum!==checksumUtf8(stableJson(checkpoint.state)) || checkpoint.coreSeq>head.coreSeq || checkpoint.memoryRevision>head.memoryRevision) throw new Error('CORE2_RECOVERY_BASELINE_INVALID');
  if (head.coreSeq-checkpoint.coreSeq>MAX_CORE_REPLAY) throw new Error('CORE2_RECOVERY_REPLAY_LIMIT');
  const operations=(await repo.queryCommittedOperations({scope,afterSeq:checkpoint.coreSeq,cutoffSeq:head.coreSeq,limit:50}));
  if (operations.nextCursor || operations.items.length!==head.coreSeq-checkpoint.coreSeq) throw new Error('CORE2_RECOVERY_COMMIT_GAP');
  const events=new Map<string,GameEvent>();
  const ids=operations.items.flatMap(operation=>operation.receipt?.eventIds??[]);
  if (new Set(ids).size!==ids.length) throw new Error('CORE2_RECOVERY_EVENT_MISMATCH');
  for (let start=0;start<ids.length;start+=200) {
    const expected=ids.slice(start,start+200);
    const page=await repo.queryEvents({scope,cutoffSeq:head.coreSeq,eventIds:expected,limit:200});
    if (page.nextCursor || page.items.length!==expected.length) throw new Error('CORE2_RECOVERY_EVENT_MISMATCH');
    for (const value of page.items) { const event=ownDto('event',value); if (!expected.includes(event.eventId) || events.has(event.eventId)) throw new Error('CORE2_RECOVERY_EVENT_MISMATCH'); events.set(event.eventId,event); }
  }
  const state=new Map<string,{record:StateRecord|null;ref:RecordRef}>();
  for (const record of checkpoint.state.records) state.set(refKey(record),{record,ref:{domain:record.domain,entityId:record.entityId,version:record.version}});
  for (const ref of checkpoint.state.tombstones??[]) state.set(refKey(ref),{record:null,ref});
  let sequence=checkpoint.coreSeq;
  for (const value of operations.items) {
    const operation=ownDto('operation',value), receipt=operation.receipt;
    if (operation.status!=='committed' || !receipt || !['committed','already_committed'].includes(receipt.status) || receipt.coreSeq!==++sequence || receipt.operationId!==operation.operationId || !sameScope(operation.scope,scope) || !sameScope(receipt.scope,scope)) throw new Error('CORE2_RECOVERY_COMMIT_GAP');
    for (const read of operation.readSet) if ((state.get(refKey(read))?.ref.version??0)!==read.version) throw new Error('CORE2_RECOVERY_STATE_MISMATCH');
    const changed=new Set<string>();
    for (const id of receipt.eventIds) {
      const event=events.get(id)!;
      if (event.commitSeq!==sequence || event.operationId!==operation.operationId || event.journeyId!==scope.journeyId || event.branchId!==scope.branchId) throw new Error('CORE2_RECOVERY_EVENT_MISMATCH');
      for (const change of event.committedChanges) {
        const key=refKey(change.ref), current=state.get(key);
        if (changed.has(key) || !operation.readSet.some(read=>sameData(read,change.ref)) || !sameData(current?.record??null,change.before) || (current?.ref.version??0)!==change.ref.version || (change.after && (change.after.version!==change.ref.version+1 || refKey(change.after)!==key || !sameScope(change.after.scope,scope)))) throw new Error('CORE2_RECOVERY_STATE_MISMATCH');
        changed.add(key); state.set(key,{record:change.after,ref:{...change.ref,version:change.ref.version+1}});
      }
    }
  }
  if (!sameData(await repo.readHead(scope),head)) throw new Error('CORE2_RECOVERY_HEAD_CHANGED');
  const values=[...state.entries()].sort(([a],[b])=>compareCoreIds(a,b)).map(([,value])=>value);
  return ownDto('snapshot',{ head,contentRefs:checkpoint.state.contentRefs,
    records:values.flatMap(value=>value.record?[value.record]:[]),tombstones:values.filter(value=>!value.record).map(value=>value.ref) });
}
