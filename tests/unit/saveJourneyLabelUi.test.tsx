// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { SaveLoadModal } from '@/components/features/SaveLoad/SaveLoadModal';
import { StorageSaveTreeGroup, StorageTreeSelector } from '@/components/features/Settings/storage/StorageSaveTreeView';
import { buildSaveTreeGroups } from '@/utils/saveTreeView';
const catalog = vi.hoisted(() => ({ items: [{ id: 1, universe: 'teyvat' as const, schemaVersion: 2, type: 'auto' as const, timestamp: 1,
  travelerName: '云', journeyDisplayName: '云', journeyOrdinal: 1, turnCount: 1, sizeBytes: 1,
  saveTree: { rootId: 'a', nodeId: 'a1', createdAt: 1 }, worldPeriodName: '', currentDate: '', currentTime: '', currentLocation: '', lastSummary: '' }],
  legacyBackups: [], pendingIds: [], unreadableIds: [], staleCatalogIds: [], hiddenBaseCount: 0, totalStoredCount: 1, catalogComplete: true }));
vi.mock('@/services/dbService', async original => ({ ...await original<object>(), getSaveCatalogSnapshot: async () => catalog }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('shows journey labels across modal selectors/detail/timeline and explains distinct round retention', async () => {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(SaveLoadModal, { onSave: async () => 1, onLoad: async () => true, onClose: () => {} })));
    expect(container.textContent?.match(/云01/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(container.textContent).toContain('最新 10 个不同回合'); expect(container.textContent).toContain('同回合分支保留'); expect(container.textContent).toContain('旧无有效回合数保守保留');
  } finally { await act(async () => root.unmount()); container.remove(); }
});
it('shows the same labels in settings selector, group heading and save detail', () => {
  const group = buildSaveTreeGroups(catalog.items)[0]!;
  const html = renderToStaticMarkup(createElement(StorageSaveTreeGroup, { group, loadingId: null, deletingId: null, deletingRootId: null, onLoad: () => {}, onExport: () => {}, onExportTree: () => {}, onDelete: () => {}, onDeleteTree: () => {}, catalogComplete: true }));
  expect(html.match(/云01/g) ?? []).toHaveLength(2);
  const selector = renderToStaticMarkup(createElement(StorageTreeSelector, { groups: [group], selectedRootId: 'a', onSelect: () => {} }));
  expect(selector).toContain('云01');
});
