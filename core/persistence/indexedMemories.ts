import type { CoreRepository,ImportedMemory,MemoryQuery,Page } from '../contracts/storage';
import { ownMemoryQuery,ownDto,scopeKey,compareCoreIds } from './repositoryValidation';
import { branchPath } from './indexedScope';
import { request,transact } from './indexedTransaction';
import { paged } from './pagination';
const intersects=<T>(values:T[],filter?:T[])=>!filter || filter.some(item=>values.includes(item));
export function createIndexedMemoryReadMethods(database:()=>Promise<IDBDatabase>):Pick<CoreRepository,'queryMemories'|'queryMemoryRows'|'readMemoryVersions'> {
  async function queryMemoryRows(input:MemoryQuery):Promise<Page<ImportedMemory>> {
    const query=ownMemoryQuery(input),db=await database();
    return transact(db,['branches','memories'],'readonly',async tx=>{
      const latest=new Map<string,ImportedMemory>();
      for(const bound of await branchPath(tx,query.scope,query.cutoffSeq,query.memoryRevision)) {
        const rows:ImportedMemory[]=[];
        if(query.memoryIds) for(const id of [...new Set(query.memoryIds)]) rows.push(...await request<ImportedMemory[]>(tx.objectStore('memories').index('by_entity').getAll([...scopeKey(bound.scope),id])));
        else rows.push(...await request<ImportedMemory[]>(tx.objectStore('memories').index('by_scope').getAll(scopeKey(bound.scope))));
        for(const row of rows) if(row.commitSeq<=bound.cutoffSeq && row.publishedRevision<=bound.memoryRevision && (latest.get(row.record.memoryId)?.record.version??0)<row.record.version)
          latest.set(row.record.memoryId,{record:row.record,commitSeq:row.commitSeq,publishedRevision:row.publishedRevision});
      }
      const items=[...latest.values()].filter(({record:memory,publishedRevision})=>(query.afterRevision===undefined || publishedRevision>query.afterRevision) && intersects([memory.memoryId],query.memoryIds) && intersects(memory.npcIds,query.npcIds) &&
        intersects([memory.layer],query.layers) && intersects([memory.status],query.statuses) && intersects(memory.turns,query.turns) &&
        intersects(memory.locations,query.locations) && (!query.keywords || query.keywords.some(word=>memory.text.includes(word))))
        .sort((a,b)=>compareCoreIds(a.record.memoryId,b.record.memoryId));
      return paged(items,query,row=>row.record.memoryId);
    });
  }
  return {queryMemoryRows,async queryMemories(input){const page=await queryMemoryRows(input);return {...page,items:page.items.map(row=>row.record)};}, async readMemoryVersions(input) {
    const query = ownDto('memoryVersionQuery', input), db = await database();
    return transact(db, ['branches', 'memories'], 'readonly', async tx => {
      const path = await branchPath(tx, query.scope, query.cutoffSeq, query.memoryRevision), records = [], seen = new Set<string>();
      for (const ref of query.refs) {
        const key = JSON.stringify([ref.memoryId, ref.version]); if (seen.has(key)) continue; seen.add(key);
        for (const bound of path) {
          const row = await request<ImportedMemory | undefined>(tx.objectStore('memories').get([...scopeKey(bound.scope), ref.memoryId, ref.version]));
          if (row && row.commitSeq <= bound.cutoffSeq && row.publishedRevision <= bound.memoryRevision) { records.push(ownDto('memory', row.record)); break; }
        }
      }
      return records;
    });
  }};
}
