import { readLiveGameState, type UseGameStateReturn } from '@/hooks/useGameState';
import type { 记忆系统 } from '@/models/memory';
import type { IrminsulMemory } from '@/models/teyvat/irminsul';
import { saveGame } from '@/services/dbService';
import { runTrackedSave, saveStatusStore } from '@/utils/saveStatus';
import { buildSavePayload, commitActiveSaveTreeMeta, getActiveSaveTreeIdentity } from './saveLoadWorkflow';

export interface MemorySaveContext { expectedSessionId: number; expectedRootId: string | null; signal?: AbortSignal }

/** Write the requested memory update together with the latest committed game root. */
export async function persistMemorySnapshot(state: UseGameStateReturn, memory: 记忆系统, irminsul?: IrminsulMemory, context?: MemorySaveContext): Promise<void> {
  const sessionId = context?.expectedSessionId ?? state.getGameSessionId();
  const expectedRootId = context ? context.expectedRootId : getActiveSaveTreeIdentity()?.rootId ?? null;
  const active = () => !context?.signal?.aborted && state.getGameSessionId() === sessionId
    && (getActiveSaveTreeIdentity()?.rootId ?? null) === expectedRootId;
  if (!active()) throw new DOMException('存档身份已变化或整理已取消，未保存旧结果。', 'AbortError');
  const liveRoot = readLiveGameState(state);
  if (!active()) throw new DOMException('存档身份已变化或整理已取消，未保存旧结果。', 'AbortError');
  const payload = buildSavePayload(state, 'auto', { 记忆: memory, ...(irminsul ? { 世界树: irminsul } : {}) }, liveRoot);
  await runTrackedSave(saveStatusStore, sessionId, liveRoot, 'auto', async () => {
    if (!active()) return false;
    await saveGame(payload);
    if (!active()) return false;
    commitActiveSaveTreeMeta(payload);
    state.setHasSave(true);
    return true;
  }, () => readLiveGameState(state), Boolean);
}
