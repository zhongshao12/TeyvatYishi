import { IDBFactory } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import { createCoreSettingsStorage } from '@/core/view/settingsStorage';
import { createCoreImagePromptLibrary } from '@/core/view/imagePromptLibrary';
it('persists and reloads custom image snippets in the Core2 settings database only', async () => {
  const factory = new IDBFactory(), storage = createCoreSettingsStorage({ factory, desktop: false }), library = createCoreImagePromptLibrary(storage);
  await library.load(); expect(library.getSnapshot()).toMatchObject({ ready: true, error: '' });
  const item = { id: 'custom-journal', name: '手账封面', category: '画风' as const, positive: 'anime fantasy, watercolor', negative: 'blurry' };
  await library.upsert(item);
  const restored = createCoreImagePromptLibrary(storage); await restored.load(); expect(restored.getSnapshot().items).toEqual([item]);
  expect((await factory.databases()).map(row => row.name)).toEqual(['TeyvatCore2SettingsDB']);
  await restored.remove(item.id); expect(await storage.loadSetting('imagePromptLibrary')).toEqual({ version: 1, items: [] });
});
