import { readLiveGameState, type UseGameStateReturn } from '@/hooks/useGameState';
import type { 记忆系统 } from '@/models/memory';
import { saveGame } from '@/services/dbService';
import { runTrackedSave, saveStatusStore } from '@/utils/saveStatus';
import { buildSavePayload, commitActiveSaveTreeMeta } from './saveLoadWorkflow';

/** Write the requested memory update together with the latest committed game root. */
export async function persistMemorySnapshot(state: UseGameStateReturn, memory: 记忆系统): Promise<void> {
  const sessionId = state.getGameSessionId();
  const liveRoot = readLiveGameState(state);
  const payload = buildSavePayload(state, 'auto', { 记忆: memory }, liveRoot);
  await runTrackedSave(saveStatusStore, sessionId, liveRoot, 'auto', async () => {
    await saveGame(payload);
    if (state.getGameSessionId() !== sessionId) return false;
    commitActiveSaveTreeMeta(payload);
    state.setHasSave(true);
    return true;
  }, () => readLiveGameState(state), Boolean);
}
