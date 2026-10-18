import { loadSetting, saveSetting } from '@/services/storage/indexedSettingsStore';
import { createImagePromptLibraryStore } from './createImagePromptLibraryStore';
export { createImagePromptLibraryStore } from './createImagePromptLibraryStore';
export type { ImagePromptLibraryStore, ImagePromptLibrarySnapshot } from './createImagePromptLibraryStore';

/** Legacy UI default only. Core2 always supplies its independent settings owner. */
export const imagePromptLibraryStore = createImagePromptLibraryStore({
  load: () => loadSetting('imagePromptLibrary'),
  save: value => saveSetting('imagePromptLibrary', value),
});
