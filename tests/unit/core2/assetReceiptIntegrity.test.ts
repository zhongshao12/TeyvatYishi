import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

// Deliberate integrity-marker collision: equality must still compare original bytes.
vi.mock('@/core/sources/sourceIntegrity', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/sources/sourceIntegrity')>();
  return { ...actual, checksumBytes: () => '0000000000000000' };
});

import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { assetPublication } from './assetRepositoryContract';
import { makeSeed } from './fixtures';

it('equal integrity markers never permit different image bytes to overwrite an existing ID', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-asset-collision-${crypto.randomUUID()}` });
  const seed = makeSeed(); await repo.initialize(seed);
  const input = assetPublication(seed); await repo.publishAsset(input);
  await expect(repo.publishAsset({ ...input, asset: { ...input.asset, bytes: new Uint8Array([1, 2, 3, 4]) } })).rejects.toThrow('CORE2_ASSET_IMMUTABLE');
  expect(Array.from((await repo.readAsset(input.asset.assetId))!.bytes)).toEqual([0, 255, 128, 10]);
});
