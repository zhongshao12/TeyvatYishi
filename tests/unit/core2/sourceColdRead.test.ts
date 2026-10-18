import { expect,it,vi } from 'vitest';
import { IDBFactory,IDBObjectStore,IDBIndex } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { makeSeed,makeSource } from './fixtures';
import { openCoreDatabase } from '@/core/persistence/indexedSchema';
import { transact,request } from '@/core/persistence/indexedTransaction';
it('a page over 5000 committed sources reads at most 51 source bodies, never getAll on original sources',async()=>{
  const seed=makeSeed();seed.sources.push(...Array.from({length:4999},(_,index)=>makeSource({scope:seed.head.scope,ref:{sourceId:`cold-${String(index).padStart(5,'0')}`,sourceVersion:1},kind:'content',blocks:[{blockId:'text',kind:'content',text:`原文 ${index} ${'长原文'.repeat(50)}`}]})));
  const repo=createIndexedRepository({factory:new IDBFactory(),databaseName:'test-core2-cold-read'});await repo.initialize(seed);
  const reads:string[]=[],bulk:string[]=[];
  const get=IDBObjectStore.prototype.get,all=IDBIndex.prototype.getAll;
  const a=vi.spyOn(IDBObjectStore.prototype,'get').mockImplementation(function(this:IDBObjectStore,key){if(this.name==='sources') reads.push(JSON.stringify(key));return get.call(this,key);});
  const b=vi.spyOn(IDBIndex.prototype,'getAll').mockImplementation(function(this:IDBIndex,...args){if(this.objectStore.name==='sources') bulk.push(this.name);return all.apply(this,args);});
  try {
    const page=await repo.querySources({scope:seed.head.scope,cutoffSeq:0});
    expect(page.items).toHaveLength(50);expect(page.nextCursor).toBeTruthy();expect(bulk).toEqual([]);expect(reads.length).toBeLessThanOrEqual(51);
    expect(reads.some(key=>key.includes('cold-04000'))).toBe(false);
    const next=await repo.querySources({scope:seed.head.scope,cutoffSeq:0,cursor:page.nextCursor});
    expect(next.items[0]!.ref.sourceId).toBe('cold-00050');expect(reads.length).toBeLessThanOrEqual(102);
  } finally {a.mockRestore();b.mockRestore();}
});
it('a missing authoritative position is an error, not a false empty source history',async()=>{
  const factory=new IDBFactory(),databaseName='test-core2-cold-corrupt',repo=createIndexedRepository({factory,databaseName}),seed=makeSeed();await repo.initialize(seed);
  const db=await openCoreDatabase(databaseName,factory);await transact(db,['sourcePositions'],'readwrite',async tx=>{await request(tx.objectStore('sourcePositions').clear());});db.close();
  await expect(repo.querySources({scope:seed.head.scope,cutoffSeq:0})).rejects.toThrow('CORE2_SOURCE_INDEX_CORRUPT');
  await expect(repo.querySources({scope:seed.head.scope,cutoffSeq:0,refs:[seed.sources[0]!.ref]})).rejects.toThrow('CORE2_SOURCE_INDEX_CORRUPT');
});
