import { describe, expect, it } from 'vitest';
import type { SaveListItemSummary } from '@/services/dbService';
import { filterSaveTreeDisplayGroup, type SaveTreeDisplayGroup } from '@/utils/saveTreeView';
import { formatByteSize } from '@/utils/formatByteSize';

function save(id: number, type: SaveListItemSummary['type'], timestamp: number, parentNodeId?: string): SaveListItemSummary {
  return {
    id,
    type,
    timestamp,
    sizeBytes: id * 1024,
    travelerName: '旅行者',
    turnCount: id,
    worldPeriodName: '蒙德',
    currentDate: '旅行历 1000.03.07',
    currentTime: '09:00',
    currentLocation: '蒙德城',
    lastSummary: `save-${id}`,
    saveTree: { rootId: 'root', nodeId: `node-${id}`, parentNodeId, createdAt: timestamp },
  };
}

describe('save tree view helpers', () => {
  it('filters a tree and recomputes latest, root, count, branches, and bytes', () => {
    const manualRoot = save(1, 'manual', 10);
    const autoChild = save(2, 'auto', 20, 'node-1');
    const manualChild = save(3, 'manual', 30, 'node-1');
    const group: SaveTreeDisplayGroup = {
      rootId: 'root', rootSave: manualRoot, latestSave: manualChild,
      nodes: [manualRoot, autoChild, manualChild].map((item, index) => ({ save: item, children: [], depth: index, isRoot: index === 0, isLatest: index === 2 })),
      nodeCount: 3, branchCount: 1, totalSizeBytes: 6 * 1024,
    };

    const filtered = filterSaveTreeDisplayGroup(group, (item) => item.type === 'manual');

    expect(filtered).toMatchObject({ nodeCount: 2, branchCount: 1, totalSizeBytes: 4 * 1024 });
    expect(filtered?.rootSave.id).toBe(1);
    expect(filtered?.latestSave.id).toBe(3);
    expect(filterSaveTreeDisplayGroup(group, () => false)).toBeNull();
  });

  it('formats byte counts consistently for storage surfaces', () => {
    expect(formatByteSize(0)).toBe('0 KB');
    expect(formatByteSize(1024)).toBe('1 KB');
    expect(formatByteSize(1536)).toBe('2 KB');
    expect(formatByteSize(1024 * 1024)).toBe('1.0 MB');
  });
});
