import { alignStoryWeavingToOpeningArchive } from '@/data/storyWeavingPreset';
import { 创建空剧情编织系统, type 剧情编织系统 } from '@/models/storyWeaving';
import type { TeyvatGameState } from '@/models/teyvat';
import { buildNewGameState, type NewGameStateInput } from './newGameState';

export async function prepareNewGameState(
  input: Omit<NewGameStateInput, 'storyWeaving'> & { loadStoryWeaving: () => Promise<剧情编织系统> },
): Promise<{ game: TeyvatGameState; storyWeaving: 剧情编织系统 }> {
  const { loadStoryWeaving, ...opening } = input;
  let source: 剧情编织系统;
  try {
    source = await loadStoryWeaving();
  } catch (error) {
    console.warn('[story-weaving] 新开局原著剧情资源加载失败，本局使用空白剧情编织:', error);
    source = 创建空剧情编织系统();
  }
  const storyWeaving = alignStoryWeavingToOpeningArchive(source, opening.world.开局档案);
  return {
    game: buildNewGameState({ ...opening, storyWeaving }),
    storyWeaving,
  };
}
