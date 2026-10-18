import { describe, expect, it } from 'vitest';
import type { CoreRepository, AssetPublication } from '@/core/contracts/storage';
import { checksumBytes } from '@/core/sources/sourceIntegrity';
import { makeSeed } from './fixtures';

export type AssetRepositoryContract = Pick<CoreRepository, 'initialize' | 'readHead' | 'activateSession' | 'readAsset' | 'publishAsset'>;

export function assetPublication(seed: ReturnType<typeof makeSeed>): AssetPublication {
  const bytes = new Uint8Array([0, 255, 128, 10]);
  return { scope: seed.head.scope, sessionId: seed.head.sessionId,
    asset: { assetId: `asset-${crypto.randomUUID()}`, scope: seed.head.scope, mimeType: 'image/webp', bytes, checksum: checksumBytes(bytes) } };
}

export function assertAssetRepositoryContract(factory: () => Promise<AssetRepositoryContract>): void {
  describe('shared immutable binary asset contract', () => {
    async function scenario() {
      const repo = await factory(), seed = makeSeed(); await repo.initialize(seed);
      expect(typeof repo.publishAsset).toBe('function');
      expect(typeof checksumBytes).toBe('function');
      return { repo, seed, input: assetPublication(seed) };
    }

    it('stores exact binary bytes and survives a new repository connection', async () => {
      const { repo, input } = await scenario(); await repo.publishAsset(input);
      expect(Array.from((await repo.readAsset(input.asset.assetId))!.bytes)).toEqual([0, 255, 128, 10]);
      const next = await factory();
      expect(Array.from((await next.readAsset(input.asset.assetId))!.bytes)).toEqual([0, 255, 128, 10]);
      expect(await next.readAsset('asset-missing')).toBeNull();
    });

    it('owns bytes before the first await and returns independent copies', async () => {
      const { repo, input } = await scenario();
      const pending = repo.publishAsset(input); input.asset.bytes.fill(42); await pending;
      const read = (await repo.readAsset(input.asset.assetId))!; read.bytes.fill(99);
      expect(Array.from((await repo.readAsset(input.asset.assetId))!.bytes)).toEqual([0, 255, 128, 10]);
    });

    it('an existing ID cannot overwrite bytes or move to another journey', async () => {
      const { repo, input } = await scenario(); await repo.publishAsset(input);
      const changed = structuredClone(input); changed.asset.bytes = new Uint8Array([1]); changed.asset.checksum = checksumBytes(changed.asset.bytes);
      await expect(repo.publishAsset(changed)).rejects.toThrow('CORE2_ASSET_IMMUTABLE');
      const other = makeSeed(); await repo.initialize(other);
      await expect(repo.publishAsset({ ...input, scope: other.head.scope, sessionId: other.head.sessionId,
        asset: { ...input.asset, scope: other.head.scope } })).rejects.toThrow('CORE2_ASSET_IMMUTABLE');
      expect((await repo.readAsset(input.asset.assetId))!.scope).toEqual(input.scope);
    });

    it('a stale session cannot publish a late image, including an already existing ID', async () => {
      const { repo, input } = await scenario(); await repo.publishAsset(input);
      await repo.activateSession(input.scope, 'session-replacement');
      await expect(repo.publishAsset(input)).rejects.toThrow('CORE2_SESSION_CHANGED');
      const late = { ...input, asset: { ...input.asset, assetId: 'asset-late' } };
      await expect(repo.publishAsset(late)).rejects.toThrow('CORE2_SESSION_CHANGED');
      expect(await repo.readAsset('asset-late')).toBeNull();
    });

    it('an exact live retry is harmless and does not advance the game head', async () => {
      const { repo, input } = await scenario(); const before = await repo.readHead(input.scope);
      await repo.publishAsset(input); await repo.publishAsset(input);
      expect(await repo.readHead(input.scope)).toEqual(before);
    });

    it('rejects checksum mismatches, foreign scopes, malformed MIME and empty bytes', async () => {
      const { repo, input } = await scenario();
      await expect(repo.publishAsset({ ...input, asset: { ...input.asset, checksum: '0000000000000000' } })).rejects.toThrow('CORE2_ASSET_CHECKSUM_MISMATCH');
      await expect(repo.publishAsset({ ...input, asset: { ...input.asset, scope: { ...input.scope, branchId: 'other' } } })).rejects.toThrow('CORE2_INVALID_ASSET_PUBLICATION');
      await expect(repo.publishAsset({ ...input, asset: { ...input.asset, mimeType: 'image/webp\r\nx:bad' } })).rejects.toThrow('CORE2_INVALID_ASSET');
      await expect(repo.publishAsset({ ...input, asset: { ...input.asset, bytes: new Uint8Array() } })).rejects.toThrow('CORE2_INVALID_ASSET');
      expect(await repo.readAsset(input.asset.assetId)).toBeNull();
    });

    it('rejects accessors without executing user code at either binary boundary', async () => {
      const { repo, input } = await scenario(); let reads = 0;
      const root = Object.defineProperty({ ...input }, 'sessionId', { enumerable: true, get() { reads++; return input.sessionId; } });
      await expect(repo.publishAsset(root)).rejects.toThrow('CORE2_INVALID_ASSET_PUBLICATION');
      const nested = Object.defineProperty({ ...input.asset }, 'bytes', { enumerable: true, get() { reads++; return input.asset.bytes; } });
      await expect(repo.publishAsset({ ...input, asset: nested })).rejects.toThrow('CORE2_INVALID_ASSET');
      expect(reads).toBe(0); expect(await repo.readAsset(input.asset.assetId)).toBeNull();
    });
  });
}
