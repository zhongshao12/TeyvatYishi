export interface StorageAttribution {
  /** Existing per-save heuristic. May already include image bytes; not additive with asset figures. */
  nodeEstimateBytes: number;
  deltaNodeCount: number;
  uniqueAssetBytes: number;
  sharedAssetBytes: number;
  unreferencedAssetBytes: number;
  assetCount: number;
}

const nonnegativeBytes = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;

/** All subtotals are separately labeled estimates; they must not be summed as disk usage. */
export function summarizeStorageAttribution(
  saves: ReadonlyArray<{ id: number; sizeBytes: number }>,
  assets: ReadonlyArray<{ id: string; bytes: number }>,
  deltas: ReadonlyArray<{ saveId: number; baseMode: 'checkpoint' | 'delta'; assetIds: string[] }>,
): StorageAttribution {
  const references = new Map<string, Set<number>>();
  for (const delta of deltas) {
    for (const id of new Set(delta.assetIds)) {
      if (!id) continue;
      const owners = references.get(id) ?? new Set<number>();
      owners.add(delta.saveId);
      references.set(id, owners);
    }
  }
  const uniqueAssets = new Map(assets.filter((asset) => asset.id).map((asset) => [asset.id, nonnegativeBytes(asset.bytes)]));
  let uniqueAssetBytes = 0;
  let sharedAssetBytes = 0;
  let unreferencedAssetBytes = 0;
  for (const [id, bytes] of uniqueAssets) {
    uniqueAssetBytes += bytes;
    const ownerCount = references.get(id)?.size ?? 0;
    if (ownerCount > 1) sharedAssetBytes += bytes;
    if (ownerCount === 0) unreferencedAssetBytes += bytes;
  }
  return {
    nodeEstimateBytes: saves.reduce((sum, save) => sum + nonnegativeBytes(save.sizeBytes), 0),
    deltaNodeCount: deltas.filter((delta) => delta.baseMode === 'delta').length,
    uniqueAssetBytes,
    sharedAssetBytes,
    unreferencedAssetBytes,
    assetCount: uniqueAssets.size,
  };
}
