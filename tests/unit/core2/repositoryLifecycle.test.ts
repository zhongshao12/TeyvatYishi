import { expect,it,vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createCoreRepository,createTestCoreRepository } from '@/core/persistence/repositoryFactory';
import { makeSeed } from './fixtures';
it('opens only the new namespace and binds the selected backend for its whole lifetime',async()=>{
  const factory=new IDBFactory(),repo=await createCoreRepository('web',{webFactory:factory});await repo.initialize(makeSeed());
  expect((await factory.databases()).map(row=>row.name)).toEqual(['TeyvatCore2DB']);
});
it('never opens a browser fallback when desktop storage fails',async()=>{
  const factory=new IDBFactory(),open=vi.spyOn(factory,'open'),send=vi.fn(async()=>{throw new Error('native unavailable');});
  const repo=await createCoreRepository('desktop',{webFactory:factory,desktopTransport:{send}});
  await expect(repo.readHead({journeyId:'journey',branchId:'branch'})).rejects.toThrow('native unavailable');expect(open).not.toHaveBeenCalled();
});
it('rejects legacy/arbitrary names and exposes test names only through the test entry',async()=>{
  const factory=new IDBFactory();
  await expect(createCoreRepository('web',{webFactory:factory,databaseName:'TimeJourneyDB'} as never)).rejects.toThrow();
  await expect(createTestCoreRepository({factory,databaseName:'TimeJourneyDB'})).rejects.toThrow();
  const repo=await createTestCoreRepository({factory,databaseName:'test-core2-factory'});await repo.initialize(makeSeed());
  expect((await factory.databases()).map(row=>row.name)).toEqual(['test-core2-factory']);
});
