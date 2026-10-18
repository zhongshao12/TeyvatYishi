import { expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { publishCoreAsset } from '@/core/persistence/assets';
import { sameAsset } from '@/core/persistence/binaryAssets';
import { makeSeed } from './fixtures';
import { assetPublication } from './assetRepositoryContract';

it('owns raw image bytes before the first await and does not change the game clock',async()=>{
  const repo=createIndexedRepository({factory:new IDBFactory(),databaseName:'test-core2-asset-service'});
  const seed=makeSeed(); await repo.initialize(seed); const before=await repo.readHead(seed.head.scope);
  const input=assetPublication(seed); const pending=publishCoreAsset(repo,input); input.asset.bytes.fill(42); await pending;
  expect(Array.from((await repo.readAsset(input.asset.assetId))!.bytes)).toEqual([0,255,128,10]);
  expect(await repo.readHead(seed.head.scope)).toEqual(before);
});
it('an interrupted publication reports failure and leaves no visible image',async()=>{
  const repo=createIndexedRepository({factory:new IDBFactory(),databaseName:'test-core2-asset-service-fault',fault(point){if(point==='asset:record')throw new Error('asset-interrupted');}});
  const seed=makeSeed(); await repo.initialize(seed); const input=assetPublication(seed);
  await expect(publishCoreAsset(repo,input)).rejects.toThrow('asset-interrupted');
  expect(await repo.readAsset(input.asset.assetId)).toBeNull();
});
it('does not use matching hash strings as proof that two images have identical bytes',()=>{
  const image=assetPublication(makeSeed()).asset;
  // Artificial equal-hash pair tests the equality boundary, not a claim that
  // these two byte arrays are a real FNV collision.
  expect(sameAsset(image,{...image,bytes:new Uint8Array([0,255,128,11]),checksum:image.checksum})).toBe(false);
  expect(sameAsset(image,{...image,bytes:new Uint8Array(image.bytes)})).toBe(true);
});
