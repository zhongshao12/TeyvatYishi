import { describe, expect, it } from 'vitest';
import { summarizeStorageAttribution } from '@/utils/storageAttribution';

describe('storage attribution', () => {
  it('counts shared assets once and keeps node estimates non-additive', () => {
    const result = summarizeStorageAttribution(
      [{ id: 1, sizeBytes: 1000 }, { id: 2, sizeBytes: 2000 }],
      [{ id: 'shared', bytes: 200 }, { id: 'solo', bytes: 100 }, { id: 'unlinked', bytes: 40 }],
      [
        { saveId: 1, baseMode: 'delta', assetIds: ['shared', 'shared', 'solo'] },
        { saveId: 2, baseMode: 'delta', assetIds: ['shared'] },
      ],
    );
    expect(result).toMatchObject({
      nodeEstimateBytes: 3000, deltaNodeCount: 2,
      uniqueAssetBytes: 340, sharedAssetBytes: 200, unreferencedAssetBytes: 40, assetCount: 3,
    });
    expect(result).not.toHaveProperty('totalActualUsageBytes');
  });
});
