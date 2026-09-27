import { readLiveGameState, type UseGameStateReturn } from '@/hooks/useGameState';
import type { 记忆系统 } from '@/models/memory';
import type { IrminsulMemory } from '@/models/teyvat/irminsul';
import { saveGame } from '@/services/dbService';
import { runTrackedSave, saveStatusStore } from '@/utils/saveStatus';
import { buildSavePayload, commitActiveSaveTreeMeta } from './saveLoadWorkflow';

/** Write the requested memory update together with the latest committed game root. */
export async function persistMemorySnapshot(state: UseGameStateReturn, memory: 记忆系统, irminsul?: IrminsulMemory): Promise<void> {
  const sessionId = state.getGameSessionId();
  const liveRoot = readLiveGameState(state);
  const payload = buildSavePayload(state, 'auto', { 记忆: memory, ...(irminsul ? { 世界树: irminsul } : {}) }, liveRoot);
  await runTrackedSave(saveStatusStore, sessionId, liveRoot, 'auto', async () => {
    await saveGame(payload);
    if (state.getGameSessionId() !== sessionId) return false;
    commitActiveSaveTreeMeta(payload);
    state.setHasSave(true);
    return true;
  }, () => readLiveGameState(state), Boolean);
}
