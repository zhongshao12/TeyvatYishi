import { describe,expect,it } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import { exportCorePackage,prepareCoreImport } from '@/core/persistence/packageTransfer';
import { makeImportFixture } from './importRepositoryContract';
import { capture,nextBatch,publishMemory,slotFor } from './snapshotRepositoryContract';
import { prepareBatch } from './repositoryContract';
import { prepareExportGraph } from '@/core/persistence/exportGraph';

export function assertExportRepositoryContract(factory:()=>Promise<CoreRepository>):void {
  describe('shared consistent export contract',()=>{
    it('imports a new journey with identical payloads, binary resources and evidence',async()=>{
      const repo=await factory(),{batch,snapshot}=await makeImportFixture(repo);
      const prepared=await prepareCoreImport(await exportCorePackage(repo,batch.scope));
      expect(prepared.manifest.scope.journeyId).not.toBe(batch.scope.journeyId);
      expect(prepared.manifest.containsPrivateData).toBe(true);
      await repo.importPrepared(prepared);
      const state=await repo.readState(prepared.manifest.scope);
      expect(state.records).toEqual(prepared.branches[0]!.state.records);
      const ordinary=(records:typeof state.records)=>records.filter(row=>!['album','news','courier'].includes(row.domain)).map(row=>row.domain==='world'?{...row.value,moment:{...row.value.moment,settlementId:'remapped-operation'}}:row.value);
      expect(ordinary(state.records)).toEqual(ordinary(snapshot.state.records));
      const sources=(await repo.querySources({scope:prepared.manifest.scope,cutoffSeq:1})).items;
      expect(sources).toHaveLength(prepared.sources.length);
      for(const row of prepared.sources) expect(await repo.readSource(row.record.ref)).toEqual(row.record);
      expect(Array.from((await repo.readAsset(prepared.assets[0]!.assetId))!.bytes)).toEqual([0,255,128,10]);
      expect((await repo.readState(batch.scope)).head).toEqual(snapshot.state.head);
    });
    it('cuts ancestor state, sources and derived memory at BOTH fork positions',async()=>{
      const repo=await factory(),{batch,snapshot}=await makeImportFixture(repo);
      const child=await repo.fork({snapshotId:snapshot.snapshotId,parentScope:batch.scope,branchId:'export-child',sessionId:'child-session'});
      const future=await nextBatch(repo,batch.scope);await prepareBatch(repo,future);await repo.commit(future);
      await publishMemory(repo,batch.scope,future.sourceRefs,future.operationId,future.events[0]!.eventId,'父分支的未来，绝不能漏进子分支');
      const raw=await repo.readExportRecords(child.scope),value=prepareExportGraph(raw);
      expect(value.branches.find(row=>row.state.head.scope.branchId===batch.scope.branchId)?.state.head).toMatchObject({coreSeq:1,memoryRevision:0});
      expect(value.events).toHaveLength(1);expect(value.memories).toEqual([]);
      expect(value.sources.some(row=>row.record.ref.sourceId===future.sourceRefs[0]!.sourceId)).toBe(false);
      expect(value.snapshots.some(row=>row.coreSeq>1)).toBe(false);
      const prepared=await prepareCoreImport(await exportCorePackage(repo,child.scope));await repo.importPrepared(prepared);
      expect((await repo.queryEvents({scope:prepared.manifest.scope,cutoffSeq:1})).items).toHaveLength(1);
    });
    it('preserves publication positions and completed-job receipts through remapping',async()=>{
      const repo=await factory(),{batch}=await makeImportFixture(repo);
      await publishMemory(repo,batch.scope,batch.sourceRefs,batch.operationId,batch.events[0]!.eventId,'共同经历');
      const snapshot=await capture(repo,batch.scope);await repo.publishSnapshot(snapshot,slotFor(snapshot));
      const prepared=await prepareCoreImport(await exportCorePackage(repo,batch.scope));
      expect(prepared.memories.map(row=>[row.commitSeq,row.publishedRevision])).toEqual([[1,1]]);
      expect(prepared.jobs.some(row=>row.publication?.receipt.memoryRevision===1)).toBe(true);
      await repo.importPrepared(prepared);
      expect((await repo.queryMemories({scope:prepared.manifest.scope,cutoffSeq:1,memoryRevision:1})).items.map(row=>row.text)).toEqual(['共同经历']);
    });
    it('owns scope before awaiting and never publishes a head when preparation is abandoned',async()=>{
      const repo=await factory(),{batch}=await makeImportFixture(repo),scope={...batch.scope};
      const pending=exportCorePackage(repo,scope);scope.journeyId='other';
      const prepared=await prepareCoreImport(await pending);
      await expect(repo.readHead(prepared.manifest.scope)).rejects.toThrow('CORE2_BRANCH_NOT_FOUND');
    });
  });
}
