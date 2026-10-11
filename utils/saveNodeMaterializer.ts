import type { 存档数据 } from '@/models/settings';
import { isDeltaOnlyStoredSave, restoreSaveFromDelta, type SaveNodeDeltaRecord } from './saveDeltaStorage';

export interface SaveNodeReader {
  loadSave(id: number): Promise<存档数据 | null>;
  loadDelta(nodeId: string): Promise<SaveNodeDeltaRecord | null>;
}

/** One dependency contract for desktop, IDB, export and destructive maintenance. */
export async function materializeSaveNode(save: 存档数据, reader: SaveNodeReader, visited = new Set<number>()): Promise<存档数据> {
  if (!isDeltaOnlyStoredSave(save)) {
    const formal = save as unknown as { universe?: string; schemaVersion?: number; 旅行者?: object; 世界?: object; 背包?: object; 手机?: object; NPC?: unknown[]; 对话?: { entries?: unknown[] } };
    if (formal.universe === 'teyvat' && (formal.schemaVersion !== 2 || !formal.旅行者 || !formal.世界 || !formal.背包 || !formal.手机
      || !Array.isArray(formal.NPC) || !Array.isArray(formal.对话?.entries))) throw new Error('SAVE_CHECKPOINT_INCOMPLETE');
    return save;
  }
  const id = Number(save.id);
  if (!Number.isSafeInteger(id) || id <= 0 || visited.has(id)) throw new Error('SAVE_DELTA_DEPENDENCY_CYCLE_OR_INVALID_ID');
  visited.add(id);
  const meta = save as 存档数据 & { saveTree?: { nodeId?: string; rootId?: string }; saveStorage?: { baseSaveId?: number } };
  if (!meta.saveTree?.nodeId) throw new Error('SAVE_DELTA_NODE_MISSING');
  const delta = await reader.loadDelta(meta.saveTree.nodeId);
  const baseId = delta?.deltaPayload?.baseSaveId;
  if (!delta?.deltaPayload || delta.nodeId !== meta.saveTree.nodeId || delta.saveId !== id
    || delta.rootId !== meta.saveTree.rootId || delta.baseMode !== 'delta'
    || !['append', 'replace'].includes(delta.deltaPayload.chatHistoryMode)
    || !Number.isSafeInteger(delta.deltaPayload.chatBaseLength) || delta.deltaPayload.chatBaseLength < 0
    || !Array.isArray(delta.deltaPayload.chatHistory) || !delta.deltaPayload.fields || typeof delta.deltaPayload.fields !== 'object'
    || !Number.isSafeInteger(baseId) || baseId! <= 0 || meta.saveStorage?.baseSaveId !== baseId) {
    throw new Error('SAVE_DELTA_DEPENDENCY_MISSING_OR_INVALID');
  }
  const rawBase = await reader.loadSave(baseId!);
  if (!rawBase) throw new Error('SAVE_DELTA_BASE_MISSING');
  const base = await materializeSaveNode(rawBase, reader, visited);
  const baseMeta = base as 存档数据 & { saveTree?: { rootId?: string }; 对话?: { entries?: unknown[] } };
  if (baseMeta.saveTree?.rootId !== meta.saveTree.rootId
    || (delta.deltaPayload.chatHistoryMode === 'append'
      && (delta.deltaPayload.chatBaseLength < 0 || delta.deltaPayload.chatBaseLength > (baseMeta.对话?.entries?.length ?? 0)))) {
    throw new Error('SAVE_DELTA_BASE_INVALID');
  }
  const restored = restoreSaveFromDelta(base, save, delta);
  if (isDeltaOnlyStoredSave(restored)) throw new Error('SAVE_DELTA_MATERIALIZATION_FAILED');
  return materializeSaveNode(restored, reader);
}
