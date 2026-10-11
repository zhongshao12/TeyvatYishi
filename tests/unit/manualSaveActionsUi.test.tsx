// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SaveLoadModal } from '@/components/features/SaveLoad/SaveLoadModal';
vi.mock('@/services/dbService', async original => ({
  ...await original<object>(),
  getSaveCatalogSnapshot: async () => ({ items: [], legacyBackups: [], pendingIds: [], unreadableIds: [], staleCatalogIds: [], hiddenBaseCount: 0, totalStoredCount: 0, catalogComplete: true }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('offers distinct overwrite and save-as actions in the save dialog', async () => {
  const onSave = vi.fn(async () => 1);
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(SaveLoadModal, { onSave, onLoad: async () => false, onClose: () => {} })));
    const button = (label: string) => [...document.querySelectorAll('button')].find(element => element.textContent === label)!;
    await act(async () => button('保存当前手动档').click());
    expect(onSave).toHaveBeenLastCalledWith({ asNewNode: false });
    await act(async () => button('另存为新节点').click());
    expect(onSave).toHaveBeenLastCalledWith({ asNewNode: true });
    await act(async () => button('另存为').click());
    expect(onSave).toHaveBeenLastCalledWith({ asNewNode: true });
  } finally { await act(async () => root.unmount()); container.remove(); }
});
