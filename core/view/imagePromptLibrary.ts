import type { CoreSettingsStorage } from './settingsStorage';
import { createImagePromptLibraryStore } from '@/utils/createImagePromptLibraryStore';
/** Explicit Core2 settings owner; never use the legacy singleton. */
export function createCoreImagePromptLibrary(storage: CoreSettingsStorage) {
  return createImagePromptLibraryStore({ load: () => storage.loadSetting('imagePromptLibrary'), save: value => storage.saveSetting('imagePromptLibrary', value) });
}
