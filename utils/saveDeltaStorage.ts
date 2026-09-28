import type { 聊天消息 } from '@/models/chat';
import type { 存档数据 } from '@/models/settings';
import type { TeyvatSaveData } from '@/models/teyvat/state';
import type { 存档树元信息 } from '@/utils/saveTree';
import { restoreLegacyDeltaView } from '@/compat/legacy-hsr/readOnly';

type FormalDeltaSave = TeyvatSaveData & Partial<Pick<存档数据, 'id' | 'type' | 'timestamp' | 'gameSettings' | 'apiSettings' | 'theme'>>;

type SaveDeltaField = '旅行者' | '背包' | '世界' | 'NPC' | '手机' | '世界树' | '图鉴' | '蒸汽鸟报' | '原著轨道' | '记忆' | '相册' | '任务' | '后台队列' | '叙事' | '斗地主'
  | 'gameSettings' | 'apiSettings' | 'theme';

export type SaveNodeBaseMode = 'checkpoint' | 'delta';

export interface SaveNodeDeltaPayload {
  baseSaveId: number;
  chatHistoryMode: 'append' | 'replace';
  chatBaseLength: number;
  chatHistory: 聊天消息[];
  fields: Partial<Record<SaveDeltaField, unknown>>;
}

export interface SaveNodeDeltaRecord {
  nodeId: string;
  rootId: string;
  parentNodeId?: string;
  saveId: number;
  type: 存档数据['type'];
  timestamp: number;
  turnCount: number;
  baseMode: SaveNodeBaseMode;
  chatFromIndex: number;
  chatTail: Array<{
    role: string;
    contentLength: number;
    hasParsedBody: boolean;
  }>;
  assetIds: string[];
  counters: {
    chatMessages: number;
    memories: number;
    irminsulEntries: number;
    codexEntries: number;
    courierContacts: number;
    npcRecords: number;
    albumAssets: number;
    albumEntries: number;
    steambirdArticles: number;
    plotNodes: number;
    variableBatches: number;
    queueTasks: number;
    quests: number;
  };
  contentHash: string;
  deltaPayload?: SaveNodeDeltaPayload;
  createdAt: number;
}

type SaveWithTree = 存档数据 & {
  saveTree?: 存档树元信息;
  saveStorage?: {
    mode: SaveNodeBaseMode;
    baseSaveId?: number;
  };
};

const CHAT_TAIL_LIMIT = 8;

const TEYVAT_DELTA_FIELDS: SaveDeltaField[] = [
  '旅行者',
  '背包',
  '世界',
  'NPC',
  '手机',
  '世界树',
  '图鉴',
  '蒸汽鸟报',
  '原著轨道',
  '记忆',
  '相册',
  '任务',
  '后台队列',
  '叙事',
  '斗地主',
  'gameSettings',
  'apiSettings',
  'theme',
];

export function buildSaveNodeDeltaRecord(
  save: 存档数据 | TeyvatSaveData,
  saveId: number,
  options?: {
    baseSave?: 存档数据 | null;
    baseSaveId?: number;
    storageMode?: SaveNodeBaseMode;
  },
): SaveNodeDeltaRecord | null {
  if (!isFormalSave(save)) return null;
  const compatibleSave = save as FormalDeltaSave;
  const tree = (save as unknown as SaveWithTree).saveTree;
  if (!tree?.rootId || !tree.nodeId) return null;
  const chatHistory = compatibleSave.对话.entries as unknown as 聊天消息[];
  const chatTailSource = chatHistory.slice(-CHAT_TAIL_LIMIT);
  const formalBase = isFormalSave(options?.baseSave) ? options.baseSave : null;
  const baseMode: SaveNodeBaseMode =
    options?.storageMode === 'delta' && formalBase && Number.isFinite(options.baseSaveId)
      && canStoreSaveAsDelta(compatibleSave, formalBase)
      ? 'delta'
      : 'checkpoint';

  return {
    nodeId: tree.nodeId,
    rootId: tree.rootId,
    parentNodeId: tree.parentNodeId,
    saveId,
    type: compatibleSave.type ?? 'auto',
    timestamp: Number(compatibleSave.timestamp) || Date.now(),
    turnCount: Number(save.turnCount) || chatHistory.length + 1,
    baseMode,
    chatFromIndex: Math.max(0, chatHistory.length - chatTailSource.length),
    chatTail: chatTailSource.map((message) => ({
      role: String(message.role ?? ''),
      contentLength: String(message.content ?? '').length,
      hasParsedBody: Boolean(message.parsedResponse?.body.length),
    })),
    assetIds: collectAssetIds(compatibleSave),
    counters: buildCounters(compatibleSave, chatHistory.length),
    contentHash: hashSaveCheckpoint(compatibleSave),
    deltaPayload: baseMode === 'delta' && formalBase && Number.isFinite(options?.baseSaveId)
      ? buildDeltaPayload(compatibleSave, formalBase, Number(options?.baseSaveId))
      : undefined,
    createdAt: Date.now(),
  };
}

export function canStoreSaveAsDelta(
  save: 存档数据 | TeyvatSaveData,
  baseSave: 存档数据 | TeyvatSaveData,
): boolean {
  if (!isFormalSave(save) || !isFormalSave(baseSave)) return false;
  const currentChat = save.对话.entries as unknown as 聊天消息[];
  const baseChat = baseSave.对话.entries as unknown as 聊天消息[];
  return isChatPrefix(currentChat, baseChat);
}

export function buildDeltaOnlyStoredSave(save: 存档数据 | TeyvatSaveData, baseSaveId: number): 存档数据 {
  const tree = (save as SaveWithTree).saveTree;
  if (isFormalSave(save)) {
    const formal = save as unknown as FormalDeltaSave;
    return {
      ...formal,
      对话: { entries: [] },
      旅行者: undefined,
      背包: undefined,
      世界: undefined,
      NPC: undefined,
      手机: undefined,
      世界树: undefined,
      图鉴: undefined,
      蒸汽鸟报: undefined,
      原著轨道: undefined,
      记忆: undefined,
      相册: undefined,
      任务: undefined,
      后台队列: undefined,
      叙事: undefined,
      斗地主: undefined,
      saveTree: tree,
      saveStorage: { mode: 'delta', baseSaveId },
    } as unknown as 存档数据;
  }
  throw new Error('LEGACY_HSR_SAVE_READ_ONLY');
}

export function isDeltaOnlyStoredSave(save: 存档数据 | null | undefined): boolean {
  return (save as SaveWithTree | null | undefined)?.saveStorage?.mode === 'delta';
}

export function restoreSaveFromDelta(baseSave: 存档数据, storedSave: 存档数据, delta: SaveNodeDeltaRecord): 存档数据 {
  const payload = delta.deltaPayload;
  if (!payload) return storedSave;
  if (!isFormalSave(baseSave) || !isFormalSave(storedSave)) {
    return restoreLegacyDeltaView(baseSave as unknown as Record<string, unknown>, storedSave as unknown as Record<string, unknown>, payload) as unknown as 存档数据;
  }
  const baseChat = baseSave.对话.entries as unknown as 聊天消息[];
  const chatHistory = payload.chatHistoryMode === 'append'
    ? [...baseChat.slice(0, payload.chatBaseLength), ...payload.chatHistory]
    : payload.chatHistory;
  return {
    ...baseSave,
    ...payload.fields,
    id: (storedSave as FormalDeltaSave).id,
    type: (storedSave as FormalDeltaSave).type,
    timestamp: (storedSave as FormalDeltaSave).timestamp,
    turnCount: storedSave.turnCount,
    对话: { entries: chatHistory },
    saveTree: (storedSave as SaveWithTree).saveTree,
    saveStorage: {
      mode: 'checkpoint',
    },
  } as 存档数据;
}

function buildDeltaPayload(save: FormalDeltaSave, baseSave: FormalDeltaSave, baseSaveId: number): SaveNodeDeltaPayload {
  const currentChat = save.对话.entries as unknown as 聊天消息[];
  const baseChat = baseSave.对话.entries as unknown as 聊天消息[];
  const chatDelta = buildChatDelta(currentChat, baseChat);
  const fields: SaveNodeDeltaPayload['fields'] = {};
  const saveRecord = save as unknown as Record<string, unknown>;
  const baseRecord = baseSave as unknown as Record<string, unknown>;
  for (const key of TEYVAT_DELTA_FIELDS) {
    if (key === 'apiSettings') continue;
    if (!jsonCompatibleEqual(saveRecord[key], baseRecord[key])) {
      fields[key] = saveRecord[key];
    }
  }
  if ('apiSettings' in save) fields.apiSettings = save.apiSettings;
  if ('gameSettings' in save) fields.gameSettings = save.gameSettings;
  if ('theme' in save) fields.theme = save.theme;
  return {
    baseSaveId,
    chatHistoryMode: chatDelta.mode,
    chatBaseLength: chatDelta.baseLength,
    chatHistory: chatDelta.messages,
    fields,
  };
}

function buildChatDelta(current: 聊天消息[], base: 聊天消息[]): {
  mode: 'append' | 'replace';
  baseLength: number;
  messages: 聊天消息[];
} {
  const baseIsPrefix = isChatPrefix(current, base);
  if (baseIsPrefix) {
    return {
      mode: 'append',
      baseLength: base.length,
      messages: current.slice(base.length),
    };
  }
  return {
    mode: 'replace',
    baseLength: 0,
    messages: current,
  };
}

function isChatPrefix(current: 聊天消息[], base: 聊天消息[]): boolean {
  return base.length <= current.length
    && base.every((message, index) => message.id === current[index]?.id);
}

function collectAssetIds(save: FormalDeltaSave): string[] {
  const ids = new Set<string>();
  for (const asset of save.相册?.assets ?? []) {
    if (asset.id) ids.add(asset.id);
  }
  return Array.from(ids).sort();
}

function buildCounters(save: FormalDeltaSave, chatMessages: number): SaveNodeDeltaRecord['counters'] {
  return {
      chatMessages,
      memories: countArray(save.记忆.longTerm),
      irminsulEntries: countArray(save.世界树.entries),
      codexEntries: countArray(save.图鉴.entries),
      courierContacts: countArray(save.手机.contacts),
      npcRecords: countArray(save.NPC),
      albumAssets: countArray(save.相册.assets),
      albumEntries: countArray(save.相册.entries),
      steambirdArticles: countArray(save.蒸汽鸟报.articles),
      plotNodes: countArray(save.叙事.plotNodes),
      variableBatches: countArray(save.叙事.variableBatches),
      queueTasks: countArray(save.后台队列.tasks),
      quests: save.任务.active.length + save.任务.completed.length + save.任务.abandoned.length,
  };
}

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function hashSaveCheckpoint(save: FormalDeltaSave): string {
  const payload = JSON.stringify({
    type: save.type,
    timestamp: save.timestamp,
    turnCount: save.turnCount,
    traveler: save.旅行者.姓名,
    location: save.世界.当前地点,
    chatCount: save.对话.entries.length,
    lastMessage: save.对话.entries.at(-1)?.content?.slice(0, 240) ?? '',
    assets: collectAssetIds(save),
  });
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isFormalSave(save: unknown): save is FormalDeltaSave {
  if (!save || typeof save !== 'object') return false;
  return (save as { universe?: unknown }).universe === 'teyvat'
    && '对话' in save
    && '手机' in save;
}

function jsonCompatibleEqual(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, WeakSet<object>>(),
): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;

  const leftObject = left as object;
  const rightObject = right as object;
  const paired = seen.get(leftObject);
  if (paired?.has(rightObject)) return true;
  if (paired) paired.add(rightObject);
  else seen.set(leftObject, new WeakSet([rightObject]));

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!jsonCompatibleEqual(left[index], right[index], seen)) return false;
    }
    return true;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(rightRecord, key)) return false;
    if (!jsonCompatibleEqual(leftRecord[key], rightRecord[key], seen)) return false;
  }
  return true;
}
