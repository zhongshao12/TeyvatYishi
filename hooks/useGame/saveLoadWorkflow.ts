import type { UseGameStateReturn } from '@/hooks/useGameState';
import { applyLegacyGameStateOverrides, fromLegacyStoryWeaving, migratePromptModules, migrateStPresetOrders, toLegacyStoryWeaving, type LegacyGameStateOverrides } from '@/hooks/useGameState';
import { normalizeTeyvatGameState, type TeyvatGameState, type TeyvatSaveData } from '@/models/teyvat';
import { classifyAndMigrateDbSaveRecord } from '@/compat/legacy-hsr/migrate';
import type { 存档数据, 存档类型, 游戏设置 } from '@/models/settings';
import type { 聊天消息 } from '@/models/chat';
import type { ArchiveCodex, CourierSystem, IrminsulMemory, SteambirdNews } from '@/models/teyvat';
import type { WithoutLegacyRuntimeSlices } from '@/compat/legacy-hsr/readOnly';
import { narrativeTurnBodyText } from '@/models/teyvat/narrativeTurn';
import { 创建空角色, 确保元素共鸣 } from '@/models/character';
import type { 角色数据结构 } from '@/models/character';
import {
  创建空API设置,
  创建默认游戏设置,
  创建默认记忆系统设置,
  创建默认手机系统设置,
  归一化文生图系统设置,
  归一化剧情编织系统设置,
  归一化记忆系统设置,
  归一化蒸汽鸟报系统设置,
  归一化图鉴系统设置,
  归一化手机系统设置,
  归一化额外功能设置,
  归一化视觉文本设置,
} from '@/models/settings';
import { loadLatestSave, loadSave, deleteSave as dbDeleteSave, saveGame, saveSetting } from '@/services/dbService';
import { clearWorkflowRecoveryJournal, isWorkflowRecoveryComplete } from '@/services/workflowRecovery';
import { normalizeMemorySystem } from './memoryUtils';
import { 归一化世界状态 } from '@/models/world';
import { 归一化NPC记录列表 } from '@/models/npc';
import { 归一化相册系统 } from '@/models/imageGeneration';
import { 归一化剧情编织系统 } from '@/models/storyWeaving';
import { 归一化任务系统 } from '@/models/quest';
import { autoAlignCanonStoryProgress } from '@/services/storyProgressService';
import { alignStoryWeavingToOpeningArchive, buildPersistedStoryWeavingSystem } from '@/data/storyWeavingPreset';
import { materializeAlbumRuntimePayload, pruneAlbumAssetCache } from '@/utils/albumObjectUrl';
import { compactDuplicatedSaveImages } from '@/utils/saveImageCompactor';
import { attachSaveTreeMeta, buildNextSaveTreeMeta, getSaveTreeMeta, type 存档树元信息 } from '@/utils/saveTree';
import { compactChatHistoryForLongSession, compactVariableBatchHistory } from '@/utils/longSessionRetention';

let activeSaveTreeMeta: 存档树元信息 | null = null;

export function clearActiveSaveTreeMetaIfMatches(target?: { rootId?: string; nodeId?: string } | null): void {
  if (!activeSaveTreeMeta) return;
  if (!target?.rootId && !target?.nodeId) {
    activeSaveTreeMeta = null;
    return;
  }
  if (
    (target.rootId && activeSaveTreeMeta.rootId === target.rootId) ||
    (target.nodeId && activeSaveTreeMeta.nodeId === target.nodeId)
  ) {
    activeSaveTreeMeta = null;
  }
}

// 共享的存档负载构造函数：手动 / 自动两条路径都走这一处，未来加字段只改一处。
// overrides 用于 sendWorkflow 里那一刻 React state 还没回写、但已有新值的字段
// （比如刚追加的 chatHistory、压缩过的 memorySystem）。
export type GameStateOverrides = WithoutLegacyRuntimeSlices<LegacyGameStateOverrides> & {
  世界树?: IrminsulMemory;
  图鉴?: ArchiveCodex;
  手机?: CourierSystem;
  蒸汽鸟报?: SteambirdNews;
};

export function buildSavePayload(
  state: UseGameStateReturn,
  type: 存档类型,
  overrides?: GameStateOverrides,
  explicitBaseGame?: TeyvatGameState,
): TeyvatSaveData {
  const timestamp = Date.now();
  const baseGame = explicitBaseGame ?? state.game;
  const compactOverrides: GameStateOverrides = {
    ...overrides,
    chatHistory: overrides?.chatHistory === undefined && explicitBaseGame !== undefined
      ? undefined
      : compactChatHistoryForLongSession(overrides?.chatHistory ?? state.chatHistory),
    variableBatches: overrides?.variableBatches === undefined && explicitBaseGame !== undefined
      ? undefined
      : compactVariableBatchHistory(overrides?.variableBatches ?? state.variableBatches),
  };
  const { 世界树, 图鉴, 手机, 蒸汽鸟报, ...legacyCompatibleOverrides } = compactOverrides;
  const legacyCompatible = applyLegacyGameStateOverrides(baseGame, legacyCompatibleOverrides);
  const payload = normalizeTeyvatGameState({
    ...legacyCompatible,
    ...(世界树 !== undefined ? { 世界树 } : {}),
    ...(图鉴 !== undefined ? { 图鉴 } : {}),
    ...(手机 !== undefined ? { 手机 } : {}),
    ...(蒸汽鸟报 !== undefined ? { 蒸汽鸟报 } : {}),
  });
  const parentSave = activeSaveTreeMeta
    ? ({ id: 0, type, timestamp, saveTree: activeSaveTreeMeta } as unknown as 存档数据)
    : null;
  const saveTree = buildNextSaveTreeMeta({
    previous: parentSave,
    type,
    timestamp,
  });
  const withTree = attachSaveTreeMeta({
    ...payload,
    id: 0,
    type,
    timestamp,
  } as unknown as 存档数据, saveTree);
  return compactDuplicatedSaveImages(withTree) as unknown as TeyvatSaveData;
}

export function commitActiveSaveTreeMeta(save: unknown): void {
  activeSaveTreeMeta = getSaveTreeMeta(save as 存档数据);
}

function buildSaveGameSettingsSnapshot(settings: 游戏设置): 游戏设置 {
  const defaults = 创建默认游戏设置();
  return {
    ...settings,
    enableClaudeMode: defaults.enableClaudeMode,
    deepSeekMainMode: defaults.deepSeekMainMode,
    backgroundTaskMode: settings.backgroundTaskMode ?? defaults.backgroundTaskMode,
    visualTextSettings: 归一化视觉文本设置(settings.visualTextSettings),
    enableCacheDiagnostics: defaults.enableCacheDiagnostics,
    variableApi: defaults.variableApi,
    蒸汽鸟报系统: {
      ...settings.蒸汽鸟报系统,
      api: defaults.蒸汽鸟报系统.api,
    },
    手机系统: {
      ...settings.手机系统,
      api: defaults.手机系统.api,
    },
    图鉴系统: {
      ...settings.图鉴系统,
      api: defaults.图鉴系统.api,
    },
    剧情编织系统: {
      ...settings.剧情编织系统,
      api: defaults.剧情编织系统.api,
    },
    文生图系统: {
      ...settings.文生图系统,
      普通接口: defaults.文生图系统.普通接口,
      场景接口: defaults.文生图系统.场景接口,
      useSeparateSceneApi: defaults.文生图系统.useSeparateSceneApi,
      NSFW接口: defaults.文生图系统.NSFW接口,
      词组转化器API: defaults.文生图系统.词组转化器API,
      正文生图: {
        ...settings.文生图系统.正文生图,
        parserApi: defaults.文生图系统.正文生图.parserApi,
        imageApi: defaults.文生图系统.正文生图.imageApi,
      },
    },
    记忆系统: {
      ...settings.记忆系统,
      记忆总结API: defaults.记忆系统.记忆总结API,
      世界树召回API: defaults.记忆系统.世界树召回API,
      世界树归档API: defaults.记忆系统.世界树归档API,
    },
  };
}

function preserveLocalApiGameSettings(nextFromSave: 游戏设置, localSettings: 游戏设置): 游戏设置 {
  const local = {
    蒸汽鸟报系统: 归一化蒸汽鸟报系统设置(localSettings.蒸汽鸟报系统),
    手机系统: 归一化手机系统设置(localSettings.手机系统 ?? 创建默认手机系统设置()),
    图鉴系统: 归一化图鉴系统设置(localSettings.图鉴系统),
    剧情编织系统: 归一化剧情编织系统设置(localSettings.剧情编织系统),
    文生图系统: 归一化文生图系统设置(localSettings.文生图系统),
    记忆系统: 归一化记忆系统设置(localSettings.记忆系统 ?? 创建默认记忆系统设置()),
  };

  return {
    ...nextFromSave,
    enableClaudeMode: localSettings.enableClaudeMode === true,
    deepSeekMainMode: localSettings.deepSeekMainMode ?? 创建默认游戏设置().deepSeekMainMode,
    backgroundTaskMode: localSettings.backgroundTaskMode ?? 创建默认游戏设置().backgroundTaskMode,
    enableCacheDiagnostics: localSettings.enableCacheDiagnostics ?? 创建默认游戏设置().enableCacheDiagnostics,
    visualTextSettings: 归一化视觉文本设置(nextFromSave.visualTextSettings),
    variableApi: localSettings.variableApi,
    蒸汽鸟报系统: {
      ...nextFromSave.蒸汽鸟报系统,
      api: local.蒸汽鸟报系统.api,
    },
    手机系统: {
      ...nextFromSave.手机系统,
      api: local.手机系统.api,
    },
    图鉴系统: {
      ...nextFromSave.图鉴系统,
      api: local.图鉴系统.api,
    },
    剧情编织系统: {
      ...nextFromSave.剧情编织系统,
      api: local.剧情编织系统.api,
    },
    文生图系统: {
      ...nextFromSave.文生图系统,
      普通接口: local.文生图系统.普通接口,
      场景接口: local.文生图系统.场景接口,
      useSeparateSceneApi: local.文生图系统.useSeparateSceneApi,
      NSFW接口: local.文生图系统.NSFW接口,
      词组转化器API: local.文生图系统.词组转化器API,
      正文生图: {
        ...nextFromSave.文生图系统.正文生图,
        parserApi: local.文生图系统.正文生图.parserApi,
        imageApi: local.文生图系统.正文生图.imageApi,
      },
    },
    记忆系统: {
      ...nextFromSave.记忆系统,
      记忆总结API: local.记忆系统.记忆总结API,
      世界树召回API: local.记忆系统.世界树召回API,
      世界树归档API: local.记忆系统.世界树归档API,
    },
  };
}

export async function handleLoadLatest(
  state: UseGameStateReturn,
): Promise<boolean> {
  const save = await loadLatestSave();
  if (!save) return false;
  await applySaveToState(save, state);
  return true;
}

export async function handleLoadById(
  id: number,
  state: UseGameStateReturn,
): Promise<boolean> {
  const save = await loadSave(id);
  if (!save) return false;
  await applySaveToState(save, state);
  return true;
}

export async function handleManualSave(state: UseGameStateReturn): Promise<number> {
  const payload = buildSavePayload(state, 'manual');
  const id = await saveGame(payload);
  commitActiveSaveTreeMeta(payload);
  return id;
}

export async function handleDeleteSave(id: number): Promise<void> {
  const save = await loadSave(id);
  await dbDeleteSave(id);
  clearActiveSaveTreeMetaIfMatches((save as { saveTree?: 存档树元信息 } | null)?.saveTree);
}

export type SaveLoadTransactionClassification =
  | { kind: 'teyvat'; state: unknown }
  | { kind: 'legacy-hsr' }
  | { kind: 'needs-input'; issues: Array<{ path: string }> }
  | { kind: 'invalid'; errors: string[] };

export interface SaveLoadTransactionDependencies {
  classify: (rawSave: unknown) => SaveLoadTransactionClassification;
  beforeReplace?: (nextGame: TeyvatSaveData) => Promise<void>;
  replaceGameState: (nextGame: TeyvatSaveData) => void;
}

export async function executeTeyvatSaveLoadTransaction(
  rawSave: unknown,
  dependencies: SaveLoadTransactionDependencies,
): Promise<TeyvatSaveData> {
  const classified = dependencies.classify(rawSave);
  if (classified.kind === 'legacy-hsr') throw new Error('LEGACY_HSR_SAVE_READ_ONLY');
  if (classified.kind === 'needs-input') throw new Error(`TEYVAT_SAVE_NEEDS_INPUT:${classified.issues.map((issue) => issue.path).join(',')}`);
  if (classified.kind === 'invalid') throw new Error(`INVALID_TEYVAT_SAVE:${classified.errors.join(',')}`);
  const nextGame = normalizeTeyvatGameState(classified.state);
  alignLoadedCanonStory(nextGame, classified.state);
  await dependencies.beforeReplace?.(nextGame);
  dependencies.replaceGameState(nextGame);
  return nextGame;
}

function alignLoadedCanonStory(nextGame: TeyvatSaveData, rawState: unknown): void {
  if (!nextGame.叙事.storyWeaving) return;
  const opening = nextGame.世界.开局设定;
  const safeWorld = 归一化世界状态({
    当前地点: nextGame.世界.当前地点,
    开局档案: opening ? {
      来源: opening.来源 === 'free' || opening.来源 === 'workshop' || opening.来源 === 'official_preset'
        ? opening.来源
        : 'official_preset',
      主线启用: opening.主线启用,
      地区ID: opening.地区ID ?? '',
      地区名称: opening.地区名称 ?? '',
      章节锚点ID: opening.章节锚点ID ?? '',
      章节锚点名称: opening.章节锚点名称 ?? '',
      章节参考说明: opening.章节参考说明 ?? '',
      参考性质: '背景参考',
      官方预设ID: opening.官方预设ID,
      创意工坊模板ID: opening.创意工坊模板ID,
      玩家介入原文: opening.玩家介入原文 ?? '',
      防回退规则: [...opening.防回退规则],
    } : undefined,
  });
  const save = rawState && typeof rawState === 'object' && !Array.isArray(rawState)
    ? rawState as { chatHistory?: unknown }
    : {};
  const recentAssistant = [...normalizeSaveChatHistory(save.chatHistory)]
    .reverse()
    .find((message) => message.role === 'assistant');
  const recentUser = [...normalizeSaveChatHistory(save.chatHistory)]
    .reverse()
    .find((message) => message.role === 'user');
  const canonicalAssistant = [...nextGame.对话.entries].reverse().find((message) => message.role === 'assistant');
  const canonicalUser = [...nextGame.对话.entries].reverse().find((message) => message.role === 'user');
  const openingAligned = alignStoryWeavingToOpeningArchive(
    toLegacyStoryWeaving(nextGame.叙事.storyWeaving),
    opening ? safeWorld.开局档案 : undefined,
  );
  const aligned = autoAlignCanonStoryProgress({
    storyWeaving: openingAligned,
    turnCount: nextGame.turnCount,
    body: recentAssistant?.parsedResponse
      ? narrativeTurnBodyText(recentAssistant.parsedResponse)
      : canonicalAssistant?.structuredResponse
        ? narrativeTurnBodyText(canonicalAssistant.structuredResponse)
        : canonicalAssistant?.content ?? '',
    userInput: recentUser?.content ?? canonicalUser?.content ?? '',
    currentLocation: safeWorld.当前地点,
    canonTrack: nextGame.原著轨道,
  });
  nextGame.叙事 = {
    ...nextGame.叙事,
    storyWeaving: fromLegacyStoryWeaving(归一化剧情编织系统(aligned.system)),
  };
}

export async function applySaveToState(
  rawSave: unknown,
  state: UseGameStateReturn,
): Promise<void> {
  const nextTreeMeta = getSaveTreeMeta(rawSave as 存档数据);
  let recoveryWasCleared = false;
  const nextGame = await executeTeyvatSaveLoadTransaction(rawSave, {
    classify: (value) => classifyAndMigrateDbSaveRecord(value, {}),
    beforeReplace: async (candidate) => {
      if (!state.interruptedWorkflow) return;
      const nextChatHistory = candidate.对话.entries.map((message) => ({
        id: message.id, role: message.role, content: message.content, timestamp: message.timestamp,
      })) as 聊天消息[];
      if (!isWorkflowRecoveryComplete(state.interruptedWorkflow, nextChatHistory)) return;
      await clearWorkflowRecoveryJournal(state.interruptedWorkflow.workflowId);
      recoveryWasCleared = true;
    },
    // A4：相册必须在**提交那一刻**就物化（`dataUrl` → `asset:` 引用）。
    // 原先是在 `replaceGameState` 之后才 `nextGame.相册 = materialize(...)`，
    // 而 `replaceGameState` 内部会 normalize 成**新对象**——于是那次赋值写在一个已经失效的对象上，
    // React 状态里的相册仍留着每张图的 base64（正是物化要消除的 MB 级字符串），且界面看不出异常。
    replaceGameState: (next) => state.replaceGameState({
      ...next,
      相册: materializeAlbumRuntimePayload(next.相册),
    }),
  });

  const nextAlbum = materializeAlbumRuntimePayload(nextGame.相册);
  pruneAlbumAssetCache(nextAlbum.assets.map((asset) => asset.id));

  activeSaveTreeMeta = nextTreeMeta;
  state.setHasSave(true);
  state.setView('game');

  if (state.interruptedWorkflow) {
    if (recoveryWasCleared) {
      state.setInterruptedWorkflow(null);
      if (state.workflowHint.startsWith('上次生成被浏览器中断')) state.setWorkflowHint('');
    } else {
      state.setWorkflowHint('上次生成被浏览器中断，输入已恢复；请检查存档后重新发送。');
    }
  }
  void nextGame;
}

function normalizeSaveChatHistory(value: unknown): 聊天消息[] {
  return Array.isArray(value) ? (value as 聊天消息[]) : [];
}

function normalizeSavedTraveler(value: unknown, _awakenedAt = ''): 角色数据结构 {
  const base = 创建空角色();
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<角色数据结构>
    : {};
  return 确保元素共鸣({
    ...base,
    id: typeof raw.id === 'string' ? raw.id : base.id,
    姓名: typeof raw.姓名 === 'string' ? raw.姓名 : base.姓名,
    别名: typeof raw.别名 === 'string' ? raw.别名 : base.别名,
    性别: typeof raw.性别 === 'string' ? raw.性别 : base.性别,
    年龄: Number.isFinite(Number(raw.年龄)) ? Number(raw.年龄) : base.年龄,
    生日: typeof raw.生日 === 'string' ? raw.生日 : base.生日,
    身高: typeof raw.身高 === 'string' ? raw.身高 : base.身高,
    身份: typeof raw.身份 === 'string' ? raw.身份 : base.身份,
    外貌: typeof raw.外貌 === 'string' ? raw.外貌 : base.外貌,
    性格: typeof raw.性格 === 'string' ? raw.性格 : base.性格,
    背景: typeof raw.背景 === 'string' ? raw.背景 : base.背景,
    头像: typeof raw.头像 === 'string' ? raw.头像 : base.头像,
    专长知识: Array.isArray(raw.专长知识) ? raw.专长知识.filter((item): item is string => typeof item === 'string') : base.专长知识,
    图像档案: raw.图像档案 && typeof raw.图像档案 === 'object' ? raw.图像档案 : base.图像档案,
    属性: raw.属性 ?? base.属性,
    主元素: raw.主元素 ?? base.主元素,
    元素共鸣: Array.isArray(raw.元素共鸣) ? raw.元素共鸣 : base.元素共鸣,
    能力: Array.isArray(raw.能力) ? raw.能力.filter((item): item is string => typeof item === 'string') : base.能力,
    天赋: Array.isArray(raw.天赋) ? raw.天赋 : base.天赋,
  });
}

function normalizeSavedGameSettings(value: unknown): 游戏设置 {
  const defaults = 创建默认游戏设置();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults;
  return {
    ...defaults,
    ...(value as Partial<游戏设置>),
  };
}
