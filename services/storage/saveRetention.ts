export const MAX_MANUAL_SAVE_NODES_PER_TREE = 5;
export const MAX_AUTO_SAVE_ROUNDS_PER_TREE = 10;

interface SaveRetentionItem {
  id: number;
  type: string;
  timestamp: number;
  turnCount?: number;
  turnCountSource?: string;
  saveTree?: {
    rootId?: string;
  };
}

export function selectSaveNodeRotationCandidates<T extends SaveRetentionItem>(items: readonly T[]): T[] {
  const buckets = new Map<string, T[]>();

  for (const item of items) {
    if (item.type !== 'manual' && item.type !== 'auto') continue;
    const rootId = item.saveTree?.rootId;
    const rootKey = rootId?.trim() ? `root:${rootId}` : `legacy-isolated-${item.type}-${item.id}`;
    const bucketKey = `${rootKey}\u0000${item.type}`;
    const bucket = buckets.get(bucketKey) ?? [];
    bucket.push(item);
    buckets.set(bucketKey, bucket);
  }

  const candidates: T[] = [];
  for (const bucket of buckets.values()) {
    const newestFirst = [...bucket].sort(compareNewestSaveNodeFirst);
    if (newestFirst[0]?.type === 'manual') {
      candidates.push(...newestFirst.slice(MAX_MANUAL_SAVE_NODES_PER_TREE));
      continue;
    }
    // Unknown/inferred legacy counts are not evidence of a shared round.
    const rounds = new Map<number, T[]>();
    for (const item of newestFirst) {
      if (item.turnCountSource !== 'explicit' || !Number.isSafeInteger(item.turnCount) || item.turnCount! < 0) continue;
      const round = rounds.get(item.turnCount!) ?? [];
      round.push(item);
      rounds.set(item.turnCount!, round);
    }
    // Insertion order follows the most recently actually saved node of each round.
    for (const round of [...rounds.values()].slice(MAX_AUTO_SAVE_ROUNDS_PER_TREE)) candidates.push(...round);
  }

  return candidates.sort(compareOldestSaveNodeFirst);
}

function compareNewestSaveNodeFirst(left: SaveRetentionItem, right: SaveRetentionItem): number {
  return right.timestamp - left.timestamp || right.id - left.id;
}

function compareOldestSaveNodeFirst(left: SaveRetentionItem, right: SaveRetentionItem): number {
  return left.timestamp - right.timestamp || left.id - right.id;
}
