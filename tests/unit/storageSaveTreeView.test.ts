import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StorageTreeSelector } from '../../components/features/Settings/storage/StorageSaveTreeView';
import { buildSaveTreeGroups } from '../../utils/saveTreeView';
import type { SaveListItemSummary } from '../../services/dbService';

function makeSave(id: number, rootId: string, travelerName: string, timestamp: number): SaveListItemSummary {
  return {
    id,
    type: 'manual',
    timestamp,
    saveTree: { rootId, nodeId: `${rootId}-${id}`, createdAt: timestamp },
    travelerName,
    turnCount: id,
    worldPeriodName: '蒙德篇',
    currentDate: '提瓦特历 1 日',
    currentTime: '10:00',
    currentLocation: '蒙德城',
    lastSummary: '从城门进入蒙德。',
    sizeBytes: 1024,
  };
}

describe('StorageSaveTreeView', () => {
  it('labels the save-tree selector and exposes only the selected tree as current', () => {
    const groups = buildSaveTreeGroups([
      makeSave(1, 'lumine-tree', '荧', 100),
      makeSave(2, 'custom-tree', '云', 200),
    ]);

    const markup = renderToStaticMarkup(createElement(StorageTreeSelector, {
      groups,
      selectedRootId: 'lumine-tree',
      onSelect: () => undefined,
    }));

    expect(markup).toContain('aria-label="存档树列表"');
    expect(markup).toContain('荧');
    expect(markup).toContain('云');
    expect(markup.match(/aria-current="true"/g)).toHaveLength(1);
  });
});
