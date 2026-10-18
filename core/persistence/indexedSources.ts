import type { CoreRepository,SourcePosition,ImportedSource } from '../contracts/storage';
import { validateCoreDto } from '../contracts/validation';
import { branch,branchPath,withinPath } from './indexedScope';
import { request,transact } from './indexedTransaction';
import { compareCoreIds,sameData,scopeKey,sourceKey,sourceRefKey } from './repositoryValidation';
import { sourcePosition } from './sourcePositions';
import { paged } from './pagination';

export function createIndexedSourceMethods(database:()=>Promise<IDBDatabase>):Pick<CoreRepository,'querySources'> {
  return {async querySources(input) {
    if(!validateCoreDto('sourceQuery',input).ok) throw new Error('CORE2_INVALID_QUERY');
    const query=structuredClone(input),db=await database();
    return transact(db,['branches','sources','sourcePositions'],'readonly',async tx=>{
      const path=await branchPath(tx,query.scope,query.cutoffSeq),store=tx.objectStore('sourcePositions');
      const positions:SourcePosition[]=[];
      if(query.refs) {
        for(const ref of query.refs) {
          const row=await request<SourcePosition|undefined>(store.get(sourceKey(ref)));
          if(row) positions.push(row);
          else {
            const original=await request<ImportedSource|undefined>(tx.objectStore('sources').get(sourceKey(ref)));
            if(original && original.commitSeq!==null && withinPath(path,original.record.scope,original.commitSeq)) throw new Error('CORE2_SOURCE_INDEX_CORRUPT');
          }
        }
      } else for(const bound of path) {
        const rows=await request<SourcePosition[]>(store.index('by_scope').getAll(scopeKey(bound.scope)));
        if(rows.length!==(await branch(tx,bound.scope)).sourceCount) throw new Error('CORE2_SOURCE_INDEX_CORRUPT');
        positions.push(...rows);
      }
      const seen=new Set<string>();
      const matched=positions.filter(row=>{
        if(row.commitSeq===null || !withinPath(path,row.scope,row.commitSeq)) return false;
        const key=sourceRefKey(row.ref);if(seen.has(key)) return false;seen.add(key);
        return (!query.kinds || query.kinds.includes(row.kind)) && (query.operationId===undefined || row.operationId===query.operationId);
      }).sort((a,b)=>compareCoreIds(a.ref.sourceId,b.ref.sourceId)||a.ref.sourceVersion-b.ref.sourceVersion);
      const page=paged(matched,query,row=>sourceRefKey(row.ref));
      const items=[];
      for(const position of page.items) {
        const row=await request<ImportedSource|undefined>(tx.objectStore('sources').get(sourceKey(position.ref)));
        if(!row || !validateCoreDto('source',row.record).ok || !sameData(sourcePosition(row.record,row.commitSeq),position)) throw new Error('CORE2_SOURCE_INDEX_CORRUPT');
        items.push(row.record);
      }
      return {items,...(page.nextCursor?{nextCursor:page.nextCursor}:{})};
    });
  }};
}
