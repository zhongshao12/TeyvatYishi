import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { checksumBytes, checksumUtf8 } from '@/core/sources/sourceIntegrity';
import { assertAssetRepositoryContract, assetPublication } from './assetRepositoryContract';
import { makeSeed } from './fixtures';

const factory = new IDBFactory(), databaseName = `test-core2-assets-${crypto.randomUUID()}`;
assertAssetRepositoryContract(async () => createIndexedRepository({ factory, databaseName }));

describe('binary integrity and atomic publication', () => {
  it('hashes original bytes rather than lossy UTF-8 decoding', () => {
    expect(typeof checksumBytes).toBe('function');
    expect(checksumBytes(new Uint8Array())).toBe('cbf29ce484222325');
    expect(checksumBytes(new Uint8Array([0]))).toBe('af63bd4c8601b7df');
    expect(checksumBytes(new Uint8Array([97]))).toBe('af63dc4c8601ec8c');
    expect(checksumBytes(new TextEncoder().encode('hello'))).toBe('a430d84680aabd0b');
    expect(checksumBytes(new Uint8Array([255]))).not.toBe(checksumBytes(new Uint8Array([128])));
    expect(checksumUtf8('hello')).toBe('a430d84680aabd0b');
  });

  it('a failure after writing binary data rolls back the asset', async () => {
    const factory = new IDBFactory(), databaseName = `test-core2-assets-fault-${crypto.randomUUID()}`;
    const repo = createIndexedRepository({ factory, databaseName, fault: point => { if (point === 'asset:record') throw new Error('injected-asset'); } });
    const seed = makeSeed(); await repo.initialize(seed);
    expect(typeof repo.publishAsset).toBe('function');
    const input = assetPublication(seed);
    await expect(repo.publishAsset(input)).rejects.toThrow('injected-asset');
    const reopened = createIndexedRepository({ factory, databaseName });
    expect(await reopened.readAsset(input.asset.assetId)).toBeNull();
    expect(await reopened.readHead(input.scope)).toEqual(seed.head);
    await reopened.publishAsset(input);
    expect(Array.from((await reopened.readAsset(input.asset.assetId))!.bytes)).toEqual([0, 255, 128, 10]);
  });
});
