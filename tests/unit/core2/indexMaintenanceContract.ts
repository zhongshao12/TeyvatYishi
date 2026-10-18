import { expect,it,vi } from 'vitest';
import { maintainCoreIndexes,requireCurrentCoreIndex } from '@/core/persistence/indexMaintenance';
import { makeImportFixture } from './importRepositoryContract';
import { publishMemory,nextBatch } from './snapshotRepositoryContract';
import { prepareBatch } from './repositoryContract';
import type {CoreRepository} from '@/core/contracts/storage';
export function assertIndexMaintenanceContract(factory:()=>Promise<CoreRepository>):void {
it('builds paged event/memory candidates from actual positions without loading source bodies or advancing world state',async()=>{
  const repo=await factory(),{batch}=await makeImportFixture(repo);
  await publishMemory(repo,batch.scope,batch.sourceRefs,batch.operationId,batch.events[0]!.eventId,'安柏送来苹果');
  const before=await repo.readHead(batch.scope),readSource=vi.spyOn(repo,'readSource'),exportAll=vi.spyOn(repo,'readExportRecords'),query=vi.spyOn(repo,'queryEvents');
  expect((await maintainCoreIndexes(repo,{scope:batch.scope,sessionId:before.sessionId})).status).toBe('published');
  expect(await repo.readHead(batch.scope)).toEqual(before);expect((await repo.readIndexStatus(batch.scope)).status).toBe('ready');
  expect(query.mock.calls.every(([query])=>query.limit===50)).toBe(true);expect(readSource).not.toHaveBeenCalled();expect(exportAll).not.toHaveBeenCalled();
});
it('does not publish after cancellation or session takeover while building',async()=>{
  const repo=await factory(),{batch}=await makeImportFixture(repo),head=await repo.readHead(batch.scope);
  const abort=new AbortController();abort.abort();const publish=vi.spyOn(repo,'publishIndex');
  expect((await maintainCoreIndexes(repo,{scope:batch.scope,sessionId:head.sessionId,signal:abort.signal})).status).toBe('cancelled');expect(publish).not.toHaveBeenCalled();
  const original=repo.queryEvents.bind(repo);vi.spyOn(repo,'queryEvents').mockImplementation(async query=>{const page=await original(query);await repo.activateSession(batch.scope,'new-session');return page;});
  expect((await maintainCoreIndexes(repo,{scope:batch.scope,sessionId:head.sessionId})).status).toBe('cancelled');expect((await repo.readIndexStatus(batch.scope)).status).toBe('missing');
});
it('reports unavailable when the index cannot catch up, never returning a falsely complete empty recall',async()=>{
  const repo=await factory(),{batch}=await makeImportFixture(repo),head=await repo.readHead(batch.scope);
  vi.spyOn(repo,'publishIndex').mockRejectedValue(new Error('quota'));await expect(requireCurrentCoreIndex(repo,{scope:batch.scope,sessionId:head.sessionId})).rejects.toThrow('CORE2_INDEX_UNAVAILABLE');
  expect((await repo.readIndexStatus(batch.scope)).status).toBe('missing');expect(await repo.readHead(batch.scope)).toEqual(head);
});
it('incrementally updates changed targets, preserving old events and removing obsolete memory terms',async()=>{
  const repo=await factory(),{batch}=await makeImportFixture(repo);
  await publishMemory(repo,batch.scope,batch.sourceRefs,batch.operationId,batch.events[0]!.eventId,'旧苹果回忆');
  await maintainCoreIndexes(repo,{scope:batch.scope,sessionId:batch.sessionId});
  const next=await nextBatch(repo,batch.scope);await prepareBatch(repo,next);await repo.commit(next);
  await publishMemory(repo,batch.scope,batch.sourceRefs,batch.operationId,batch.events[0]!.eventId,'新的蒲公英记忆',1);
  const events=vi.spyOn(repo,'queryEvents'),memories=vi.spyOn(repo,'queryMemoryRows');
  await maintainCoreIndexes(repo,{scope:batch.scope,sessionId:batch.sessionId});
  expect(events.mock.calls[0]![0]).toMatchObject({afterSeq:1});expect(memories.mock.calls[0]![0]).toMatchObject({afterRevision:1});
  const page=await repo.queryPostings({scope:batch.scope,cutoffSeq:2,memoryRevision:2,limit:200});
  expect(page.items.some(row=>row.targetId===batch.events[0]!.eventId)).toBe(true);
  expect(page.items.some(row=>row.target==='memory' && row.kind==='keyword' && row.key==='旧苹')).toBe(false);
  expect(page.items.some(row=>row.target==='memory' && row.kind==='keyword' && row.key==='蒲公')).toBe(true);
});

}
