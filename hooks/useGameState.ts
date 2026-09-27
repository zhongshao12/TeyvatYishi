import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { flushSync } from 'react-dom';
import type { 角色数据结构 } from '@/models/character';
import { 创建空角色 } from '@/models/character';
import type { 世界状态 } from '@/models/world';
import { 创建空世界状态, 归一化世界状态 } from '@/models/world';
import type { 聊天消息 } from '@/models/chat';
import type { 记忆系统 } from '@/models/memory';
import { 创建空记忆系统 } from '@/models/memory';
import {
  LEGACY_CODEX_SETTING_KEY,
  readLegacyGameSettingRoutes,
  readLegacyRuntimeSlices,
  type 旧世界树系统,
  type 旧图鉴系统,
  type 旧报刊条目,
} from '@/compat/legacy-hsr/readOnly';
import type { NPC记录 } from '@/models/npc';
import type { 相册系统 } from '@/models/imageGeneration';
import { 创建空相册系统, 归一化相册系统 } from '@/models/imageGeneration';
import type { 剧情节点 } from '@/models/plot';
import type { 剧情编织系统 } from '@/models/storyWeaving';
import { 创建空剧情编织系统, 归一化剧情编织系统 } from '@/models/storyWeaving';
import type { 变量命令批次 } from '@/models/variableCommand';
import type { 队列任务记录 } from '@/models/queueTask';
import type { 任务系统 } from '@/models/quest';
import { 创建空任务系统 } from '@/models/quest';
import type { ArchiveCodex, CourierSystem, IrminsulMemory, SteambirdNews } from '@/models/teyvat';
import type { API设置, 游戏设置, 主题预设 } from '@/models/settings';
import type { 存档数据 } from '@/models/settings';
import {
  创建空API设置,
  创建默认游戏设置,
  创建默认蒸汽鸟报系统设置,
  创建默认记忆系统设置,
  创建默认图鉴系统设置,
  创建默认剧情编织系统设置,
  创建默认手机系统设置,
  创建默认文生图系统设置,
  归一化记忆系统设置,
  归一化提示词模块ID,
  归一化蒸汽鸟报系统设置,
  归一化图鉴系统设置,
  归一化剧情编织系统设置,
  归一化手机系统设置,
  归一化文生图系统设置,
  归一化额外功能设置,
  归一化视觉文本设置,
} from '@/models/settings';
import type { 提示词模块 } from '@/models/prompts';
import type { STPresetEntry } from '@/models/stTypes';
import { migrateSTPresetsV1ToV2 } from '@/utils/stPresetMigration';
import { normalizeRetiredTavernSelection } from '@/utils/retiredTavernPresets';
import { BUILTIN_NARRATIVE_MODULE_IDS, BUILTIN_PROMPT_MODULE_IDS, LEGACY_BUILTIN_COT_ID, getDefaultModuleFields } from '@/models/prompts';
import { isSTImportedModule } from '@/utils/stPresetParser';
import { createBuiltinPromptModules } from '@/data/builtinPromptModules';
import { migratePromptDeliveryTargets } from '@/services/promptDelivery';
import {
  CODEX_CHARACTER_REBUILD_MIGRATION_KEY,
  isBundledCodexDuplicate,
  loadAllBundledCodexPresets,
  mergeBundledCodexSystem,
  removeLegacyCodexCharacterEntries,
  removeRetiredCodexEntries,
  升级自制图鉴系统,
} from '@/data/codexPreset';
import { buildPersistedStoryWeavingSystem, hydratePersistedStoryWeavingSystem, isSelfContainedStoryWeavingSystem, loadAllBundledStoryWeavingPresets } from '@/data/storyWeavingPreset';
import type { 世界书 } from '@/models/worldbook';
import { loadWorkflowRecoveryJournal, type WorkflowRecoveryJournal } from '@/services/workflowRecovery';
import { applyTheme, normalizeThemeId } from '@/styles/themes';
import { loadSetting, saveSetting, hasAnySave } from '@/services/dbService';
import type { SaveListItemSummary } from '@/services/dbService';
import { WORLDBOOK_STORAGE_KEY, normalizeWorldbooks } from '@/utils/worldbook';
import { createBuiltinWorldbooks } from '@/data/worldbookPresets';
import { loadAllBundledWorldbookPresets } from '@/data/openingWorldbookPreset';
import {
  createEmptyTeyvatGameState,
  normalizeTeyvatGameState,
  normalizeTeyvatWorld,
  normalizeConversationLog,
  normalizeJourneyAlbum,
  normalizeMemoryLedger,
  normalizeNarrativeRuntime,
  normalizeArchiveCodex,
  normalizeCourierSystem,
  reconcileCourierContactsWithNpcs,
  normalizeIrminsulMemory,
  normalizeSteambirdNews,
  normalizeTechnicalJsonValue,
  normalizeTeyvatNpcRecords,
  type ElementId,
  type ConversationTurnCheckpoint,
  type TechnicalJsonValue,
  type TeyvatGameState,
  type TeyvatInventory,
  type TeyvatSaveData,
} from '@/models/teyvat';
import { useTeyvatRuntime } from './useTeyvatRuntime';

const REMOVED_LEGACY_WORLDBOOK_IDS = new Set([
  'builtin_express_crew',
  'builtin_locations',
  'opening_core',
  // 批次5(D10, 2026-07-26): 四本规则书整体迁移为提示词模块 builtin_rule_* 系列,清理旧存档残留
  'builtin_opening_rule',
  'builtin_narrative_general',
  'builtin_forbidden_phrases',
  'builtin_power_system_overview',
]);

function isCalibrationWorldbook(book: 世界书): boolean {
  return book.entries.some((entry) => entry.scope?.includes('calibration'));
}

export type ViewState = 'home' | 'new_game' | 'game';

export function migratePromptModules(savedGame: 游戏设置): 提示词模块[] {
  const builtins = createBuiltinPromptModules();
  const saved = Array.isArray(savedGame.promptModules)
    ? savedGame.promptModules.map((module) => ({ ...module, id: 归一化提示词模块ID(module.id) }))
    : [];

  // 最早版本的 builtin_cot 只在读取时迁移启用状态；新内容始终来自原生开场/主叙事模块。
  const legacyCot = saved.find((m) => m.id === LEGACY_BUILTIN_COT_ID);

  const mergedBuiltins = builtins.map((b) => {
    const hit = saved.find((m) => m.id === b.id);
    if (hit) {
      // 内置模块 content / title / description / scope / category / order 永远以源码为准(UI 上对内置为只读),
      // 只保留用户可调的主剧情 enabled / 时间戳。否则 IndexedDB 里持久化的旧 content / 旧 order
      // 会反向覆盖源码更新,导致改了源码但跑出旧 prompt / 旧 order 区间。
      // calibration/独立模型模块只是服务层真实 prompt 的只读展示，不是 API 开关；旧存档里曾关闭也必须拉回展示状态。
      //
      // 方案 A 三层 order 区间迁移：旧存档 order 是 5-90 区间，新源码 order 是 5-1043（Tier 1: 1-99 / Tier 2: 100-999 ST / Tier 3: 1000+ 压轴）。
      // 强制用 b.order（源码定义），旧存档自动迁移到新 order 区间。
      const isCalibrationBuiltin = b.scope?.includes('calibration');
      return {
        ...b,
        enabled: isCalibrationBuiltin ? true : hit.enabled,
        createdAt: hit.createdAt ?? b.createdAt,
        updatedAt: hit.updatedAt ?? b.updatedAt,
      };
    }
    // 没存档命中但有 legacy_cot：把它的 enabled 借给两个原生叙事模块。
    if (legacyCot && (b.id === BUILTIN_NARRATIVE_MODULE_IDS.opening || b.id === BUILTIN_NARRATIVE_MODULE_IDS.main)) {
      return { ...b, enabled: legacyCot.enabled };
    }
    return b;
  });

  const builtinIdSet = new Set<string>(BUILTIN_PROMPT_MODULE_IDS);
  // 过滤掉 legacy 'builtin_cot'：已被新 opening/main_plot 覆盖
  // 同 id 去重：历史 bug 曾把内置 id 漏出白名单导致多份副本叠加，这里兜底清理
  const seenIds = new Set<string>();
  const customs = saved.filter((m) => {
    if (builtinIdSet.has(m.id)) return false;
    if (m.id === LEGACY_BUILTIN_COT_ID) return false;
    if (seenIds.has(m.id)) return false;
    seenIds.add(m.id);
    return true;
  });

  // 旧存档的自定义模块可能缺少 ST 预设兼容字段，用默认值兜底
  // 方案 A 三层 order 区间迁移：ST 导入模块旧 order 是 50+，新区间是 100-999，需要 +50 偏移
  const customsWithDefaults = customs.map((m) => {
    const withDefaults = {
      ...getDefaultModuleFields(),
      source: 'user' as const,
      replaceable: 'replaceable' as const,
      ...m,
    };
    // ST 导入模块：旧 order < 100 时 +50 偏移，落入 Tier 2 区间（100-999）
    if (isSTImportedModule(withDefaults) && withDefaults.order < 100) {
      return { ...withDefaults, order: withDefaults.order + 50 };
    }
    return withDefaults;
  });

  const hasLegacy = customsWithDefaults.some((m) => m.id === 'legacy_custom');
  if (!hasLegacy && savedGame.customPrompt && savedGame.customPrompt.trim()) {
    const now = Date.now();
    customsWithDefaults.push({
      ...getDefaultModuleFields(),
      source: 'user',
      replaceable: 'replaceable',
      id: 'legacy_custom',
      title: '旧版自定义提示词',
      description: '自旧版「额外指示」迁移而来。可自由编辑或删除。',
      category: 'custom',
      content: savedGame.customPrompt,
      enabled: true,
      builtin: false,
      order: 900,
      scope: ['all'],
      createdAt: now,
      updatedAt: now,
    });
  }

  return migratePromptDeliveryTargets([...mergedBuiltins, ...customsWithDefaults]);
}

/** 方案 A 三层 order 区间迁移：把预设库里的 ST 模块 order 从 50+ 迁移到 100+。
 *  - 旧版 ST 模块 order = 50 + array_index（与内置 CoT/worldbook 冲突）
 *  - 新版 ST 模块 order = 100 + array_index（Tier 2 区间 100-999）
 *  - order < 100 的 ST 模块 +50 偏移；order >= 100 的不动（已是新版或玩家手动调整过）
 *  - 没有预设库或预设库为空时返回原值（保持字段缺省）
 *
 *  放在 useGameState.ts 与 migratePromptModules 并列，供初次 mount 加载路径和
 *  saveLoadWorkflow 手动加载路径共用，避免两条加载路径迁移逻辑不一致。 */
export function migrateStPresetOrders(stPresets: STPresetEntry[] | undefined): STPresetEntry[] | undefined {
  if (!Array.isArray(stPresets) || stPresets.length === 0) return stPresets;
  return stPresets.map((preset) => {
    const needsMigration = preset.modules.some(
      (m) => isSTImportedModule(m) && m.order < 100,
    );
    if (!needsMigration) return preset;
    return {
      ...preset,
      modules: preset.modules.map((m) =>
        isSTImportedModule(m) && m.order < 100
          ? { ...m, order: m.order + 50 }
          : m,
      ),
      updatedAt: Date.now(),
    };
  });
}

function applyStateAction<T>(current: T, action: React.SetStateAction<T>): T {
  return typeof action === 'function' ? (action as (value: T) => T)(current) : action;
}

export function toLegacyTraveler(game: TeyvatGameState): 角色数据结构 {
  const base = 创建空角色();
  return {
    ...base,
    id: game.旅行者.id,
    姓名: game.旅行者.姓名, 别名: game.旅行者.别名, 性别: game.旅行者.性别,
    年龄: game.旅行者.年龄, 生日: game.旅行者.生日, 身高: game.旅行者.身高,
    身份: game.旅行者.身份, 外貌: game.旅行者.外貌, 性格: game.旅行者.性格,
    背景: game.旅行者.背景, 专长知识: game.旅行者.专长知识, 头像: game.旅行者.头像,
    图像档案: {
      头像: game.旅行者.visualArchive.profileImage,
      正文头像: game.旅行者.visualArchive.narrativeImage,
      手机头像: game.旅行者.visualArchive.courierImage,
      立绘: game.旅行者.visualArchive.fullPortrait,
    },
    属性: { ...base.属性, ...game.旅行者.attributes },
    主元素: game.旅行者.主元素,
    元素共鸣: game.旅行者.元素共鸣.map((attunement) => ({ ...attunement })),
    能力: [...game.旅行者.capabilities],
    天赋: game.旅行者.天赋.map((talent) => ({ ...talent })),
  };
}

function withLegacyTraveler(game: TeyvatGameState, traveler: 角色数据结构): TeyvatGameState {
  return {
    ...game,
    旅行者: {
      ...game.旅行者,
      id: traveler.id, 姓名: traveler.姓名, 别名: traveler.别名, 性别: traveler.性别, 年龄: traveler.年龄,
      生日: traveler.生日, 身高: traveler.身高, 身份: traveler.身份, 外貌: traveler.外貌,
      性格: traveler.性格, 背景: traveler.背景, 专长知识: [...traveler.专长知识], 头像: traveler.头像,
      主元素: traveler.主元素, attributes: Object.fromEntries(Object.entries(traveler.属性).map(([key, value]) => [key, Number(value) || 0])),
      capabilities: [...traveler.能力],
      visualArchive: {
        profileImage: traveler.图像档案?.头像, narrativeImage: traveler.图像档案?.正文头像,
        courierImage: traveler.图像档案?.手机头像, fullPortrait: traveler.图像档案?.立绘,
      },
      元素共鸣: traveler.元素共鸣.map((attunement) => ({ ...attunement })),
      天赋: traveler.天赋.map((talent) => ({ ...talent })),
    },
  };
}

function toLegacyDifficulty(value: string): 世界状态['难度'] {
  return value === 'easy' || value === 'hard' || value === 'extreme' ? value : value === 'normal' ? 'normal' : undefined;
}

function toLegacyNarrativeMode(value: string): 世界状态['剧情模式'] {
  return value === 'harem' || value === 'romance_alt' || value === 'deep_single' ? value : value === 'normal' ? 'normal' : undefined;
}

export function toLegacyWorld(game: TeyvatGameState): 世界状态 {
  const opening = game.世界.开局设定;
  return 归一化世界状态({
    当前时段: game.世界.当前时段 ?? undefined,
    已访问时段: game.世界.已访问时段, 纪年法: game.世界.纪年名称, 旅程天数: game.世界.旅程天数,
    当前日期: game.世界.当前日期, 当前时间: game.世界.当前时间, 当前地区: game.世界.当前地区 || undefined, 当前地点: game.世界.当前地点,
    当前天气: game.世界.当前天气, 全局事件: game.世界.世界事件, 活跃人物: game.世界.活跃人物,
    氛围变化: game.世界.氛围, 难度: toLegacyDifficulty(game.世界.难度), 剧情模式: toLegacyNarrativeMode(game.世界.叙事模式),
    起航之地ID: game.世界.起始场景ID || undefined, 自定义开局: game.世界.自定义开局 || undefined,
    原著主角: game.世界.原著旅行者 || undefined,
    开局档案: opening ? {
      来源: opening.来源 === 'free' || opening.来源 === 'workshop' ? opening.来源 : 'official_preset',
      主线启用: opening.主线启用, 地区ID: opening.地区ID ?? '', 地区名称: opening.地区名称 ?? '',
      章节锚点ID: opening.章节锚点ID ?? '', 章节锚点名称: opening.章节锚点名称 ?? '',
      章节参考说明: opening.章节参考说明 ?? '', 参考性质: '背景参考', 官方预设ID: opening.官方预设ID,
      创意工坊模板ID: opening.创意工坊模板ID, 玩家介入原文: opening.玩家介入原文 ?? '', 防回退规则: [...opening.防回退规则],
    } : undefined,
    元素回响邀请: game.世界.元素回响邀请 as never, 进行中元素回响: game.世界.进行中元素回响 as never,
  });
}

export function applyLegacyWorldState(game: TeyvatGameState, world: 世界状态): TeyvatGameState {
  return {
    ...game,
    世界: normalizeTeyvatWorld({
      ...game.世界,
      当前地区: world.当前地区 ?? game.世界.当前地区,
      当前地点: world.当前地点, 当前日期: world.当前日期, 当前时间: world.当前时间,
      当前天气: world.当前天气 ?? '', 世界事件: [...world.全局事件], 氛围: world.氛围变化,
      当前时段: { id: world.当前时段.id, 名称: world.当前时段.名称, 年代: world.当前时段.年代, 描述: world.当前时段.描述, 氛围: world.当前时段.氛围, 关键事件: [...world.当前时段.关键事件], 科技水平: world.当前时段.科技水平, 社会规范: world.当前时段.社会规范, 派系: world.当前时段.派系.map((faction) => ({ id: faction.id, 名称: faction.名称, 描述: faction.描述, 影响力: faction.影响力 })), 人物: world.当前时段.人物.map((actor) => ({ id: actor.id, 姓名: actor.姓名, 角色: actor.角色, 性格: actor.性格, 外貌: actor.外貌, 与玩家关系: actor.与玩家关系, 记忆: [...actor.记忆] })) },
      已访问时段: [...world.已访问时段], 纪年名称: world.纪年法, 旅程天数: world.旅程天数,
      活跃人物: world.活跃人物.map((actor) => ({ id: actor.id, 姓名: actor.姓名, 角色: actor.角色, 性格: actor.性格, 外貌: actor.外貌, 与玩家关系: actor.与玩家关系, 记忆: [...actor.记忆] })),
      难度: world.难度 ?? '', 叙事模式: world.剧情模式 ?? '',
      开局设定: world.开局档案 ? { 来源: world.开局档案.来源, 主线启用: world.开局档案.主线启用, 地区ID: world.开局档案.地区ID, 地区名称: world.开局档案.地区名称, 章节锚点ID: world.开局档案.章节锚点ID, 章节锚点名称: world.开局档案.章节锚点名称, 章节参考说明: world.开局档案.章节参考说明, 参考性质: world.开局档案.参考性质, 官方预设ID: world.开局档案.官方预设ID, 创意工坊模板ID: world.开局档案.创意工坊模板ID, 玩家介入原文: world.开局档案.玩家介入原文, 防回退规则: [...world.开局档案.防回退规则] } : null,
      起始场景ID: world.起航之地ID ?? '', 自定义开局: world.自定义开局 ?? '',
      原著旅行者: world.原著主角 ?? '', 元素回响邀请: world.元素回响邀请 ?? '', 进行中元素回响: world.进行中元素回响 ?? '',
    }),
  };
}

function technicalJsonToLegacy(value: TechnicalJsonValue): unknown {
  if (Array.isArray(value)) return value.map(technicalJsonToLegacy);
  if (value && typeof value === 'object') return Object.fromEntries(value.entries.map((entry) => [entry.key, technicalJsonToLegacy(entry.value)]));
  return value;
}

export function fromLegacyTurnCheckpoint(snapshot: NonNullable<聊天消息['preTurnSnapshot']>): ConversationTurnCheckpoint {
  const hasInventory = Object.prototype.hasOwnProperty.call(snapshot, '背包');
  const rawSnapshot = snapshot as typeof snapshot & Record<string, unknown>;
  let root = applyLegacyGameStateOverrides(createEmptyTeyvatGameState(), {
    旅人: snapshot.旅人 as 角色数据结构,
    ...(hasInventory ? { 背包: snapshot.背包 as TeyvatInventory | undefined } : {}),
    世界: snapshot.世界 as 世界状态,
    记忆: snapshot.记忆 as 记忆系统,
    NPC: snapshot.NPC as NPC记录[],
    相册: snapshot.相册 as 相册系统 | undefined,
    剧情: snapshot.剧情 as 剧情节点[],
    剧情编织: snapshot.剧情编织 as 剧情编织系统 | undefined,
    variableBatches: snapshot.variableBatches as 变量命令批次[],
    queueTasks: snapshot.queueTasks as 队列任务记录[] | undefined,
    任务: snapshot.任务 as 任务系统 | undefined,
    turnCount: snapshot.turnCount,
  });
  const legacySlices = readLegacyRuntimeSlices(rawSnapshot);
  if (Object.prototype.hasOwnProperty.call(rawSnapshot, '世界树')) root = { ...root, 世界树: normalizeIrminsulMemory(rawSnapshot.世界树) };
  else if (legacySlices.hasIrminsul && legacySlices.irminsul) root = applyLegacyIrminsul(root, legacySlices.irminsul);
  if (Object.prototype.hasOwnProperty.call(rawSnapshot, '图鉴')) root = { ...root, 图鉴: normalizeArchiveCodex(rawSnapshot.图鉴) };
  else if (legacySlices.hasCodex && legacySlices.codex) root = applyLegacyCodex(root, legacySlices.codex);
  if (Object.prototype.hasOwnProperty.call(rawSnapshot, '手机')) root = { ...root, 手机: normalizeCourierSystem(rawSnapshot.手机) };
  if (Object.prototype.hasOwnProperty.call(rawSnapshot, '蒸汽鸟报')) root = { ...root, 蒸汽鸟报: normalizeSteambirdNews(rawSnapshot.蒸汽鸟报) };
  else if (legacySlices.hasSteambird && legacySlices.steambird) root = applyLegacySteambird(root, legacySlices.steambird);
  return {
    turnCount: root.turnCount, pendingOpeningTrigger: snapshot.pendingOpeningTrigger ?? null,
    traveler: root.旅行者, world: root.世界, npc: root.NPC, ...(hasInventory ? { inventory: root.背包 } : {}),
    ...(Object.prototype.hasOwnProperty.call(rawSnapshot, '手机') ? { courier: root.手机 } : {}),
    ...(Object.prototype.hasOwnProperty.call(rawSnapshot, '世界树') || legacySlices.hasIrminsul ? { irminsul: root.世界树 } : {}),
    ...(Object.prototype.hasOwnProperty.call(rawSnapshot, '图鉴') || legacySlices.hasCodex ? { codex: root.图鉴 } : {}),
    ...(Object.prototype.hasOwnProperty.call(rawSnapshot, '蒸汽鸟报') || legacySlices.hasSteambird ? { steambird: root.蒸汽鸟报 } : {}),
    memory: root.记忆,
    album: root.相册, quest: root.任务, queue: root.后台队列, narrative: root.叙事,
  };
}

export function toLegacyTurnCheckpoint(checkpoint: ConversationTurnCheckpoint): NonNullable<聊天消息['preTurnSnapshot']> {
  const base = createEmptyTeyvatGameState();
  const root = normalizeTeyvatGameState({
    ...base, turnCount: checkpoint.turnCount, 旅行者: checkpoint.traveler ?? base.旅行者,
    世界: checkpoint.world ?? base.世界, NPC: checkpoint.npc ?? base.NPC, 背包: checkpoint.inventory ?? base.背包,
    手机: checkpoint.courier ?? base.手机, 世界树: checkpoint.irminsul ?? base.世界树, 图鉴: checkpoint.codex ?? base.图鉴,
    蒸汽鸟报: checkpoint.steambird ?? base.蒸汽鸟报, 记忆: checkpoint.memory ?? base.记忆, 相册: checkpoint.album ?? base.相册,
    任务: checkpoint.quest ?? base.任务, 后台队列: checkpoint.queue ?? base.后台队列, 叙事: checkpoint.narrative ?? base.叙事,
  });
  return {
    旅人: toLegacyTraveler(root), ...(checkpoint.inventory !== undefined ? { 背包: root.背包 } : {}), 世界: toLegacyWorld(root), 记忆: toLegacyMemory(root),
    ...(checkpoint.irminsul !== undefined ? { 世界树: root.世界树 } : {}),
    ...(checkpoint.codex !== undefined ? { 图鉴: root.图鉴 } : {}),
    ...(checkpoint.courier !== undefined ? { 手机: root.手机 } : {}),
    NPC: mapTeyvatNpcsToLegacy(root), 相册: toLegacyAlbum(root),
    ...(checkpoint.steambird !== undefined ? { 蒸汽鸟报: root.蒸汽鸟报 } : {}), 剧情: toLegacyPlot(root.叙事.plotNodes), 剧情编织: toLegacyStoryWeaving(root.叙事.storyWeaving),
    variableBatches: toLegacyVariableBatches(root.叙事.variableBatches), queueTasks: toLegacyQueue(root), 任务: toLegacyQuest(root),
    turnCount: checkpoint.turnCount, pendingOpeningTrigger: checkpoint.pendingOpeningTrigger,
  };
}

function toLegacyChat(game: TeyvatGameState): 聊天消息[] {
  return game.对话.entries.map((entry) => ({
    id: entry.id, role: entry.role, content: entry.content, timestamp: entry.timestamp, gameTime: entry.gameTime,
    parsedResponse: entry.structuredResponse ? {
      body: entry.structuredResponse.body.map((block) => ({ ...block })),
      choices: entry.structuredResponse.choices.map((choice) => ({ ...choice })),
      factCandidates: entry.structuredResponse.factCandidates.map((candidate) => ({ ...candidate })),
      continuation: {
        summary: entry.structuredResponse.continuation.summary,
        unresolved: [...entry.structuredResponse.continuation.unresolved],
      },
    } : undefined,
    inputTokens: entry.inputTokens, outputTokens: entry.outputTokens,
    tokenUsage: entry.tokenUsage ? {
      inputTokens: entry.tokenUsage.inputTokens, outputTokens: entry.tokenUsage.outputTokens, totalTokens: entry.tokenUsage.totalTokens,
      cachedTokens: entry.tokenUsage.cachedTokens, uncachedTokens: entry.tokenUsage.uncachedTokens, cacheHitRate: entry.tokenUsage.cacheHitRate,
      source: entry.tokenUsage.source, provider: entry.tokenUsage.provider, model: entry.tokenUsage.model,
      usageFormat: entry.tokenUsage.usageFormat, usagePath: entry.tokenUsage.usagePath, rawUsageKeys: [...entry.tokenUsage.rawUsageKeys],
      system: entry.tokenUsage.system, cacheDiagnostic: entry.tokenUsage.cacheDiagnostic,
    } : undefined,
    responseDurationSec: entry.responseDurationSec, isStreaming: entry.streaming, bookmark: entry.bookmark,
    preTurnSnapshot: entry.preTurnState ? toLegacyTurnCheckpoint(entry.preTurnState) : undefined,
    debugContext: entry.debugMetadata ? {
      systemPrompt: entry.debugMetadata.systemPrompt, messages: entry.debugMetadata.messages.map((message) => ({ ...message })),
      recallPreview: entry.debugMetadata.recallPreview, recallSummary: entry.debugMetadata.recallSummary, recallFullContent: entry.debugMetadata.recallFullContent,
      deepSeekMainMode: entry.debugMetadata.deepSeekMainMode, deepSeekCotFakeHistorySkipped: entry.debugMetadata.deepSeekCotFakeHistorySkipped,
      deepSeekPrefixMode: entry.debugMetadata.deepSeekPrefixMode, deepSeekProtocolIssues: [...entry.debugMetadata.deepSeekProtocolIssues],
      deepSeekMainOriginalModel: entry.debugMetadata.deepSeekMainOriginalModel, deepSeekMainAdaptedModel: entry.debugMetadata.deepSeekMainAdaptedModel,
      stV2Attempted: entry.debugMetadata.stV2Attempted, stV2Used: entry.debugMetadata.stV2Used, stV2FallbackReason: entry.debugMetadata.stV2FallbackReason,
      rerollSimilarity: entry.debugMetadata.rerollSimilarity, rerollSimilarityRetried: entry.debugMetadata.rerollSimilarityRetried,
      cachePrefixDiagnostics: entry.debugMetadata.cachePrefixDiagnostics ? { ...entry.debugMetadata.cachePrefixDiagnostics, largestChangedSections: entry.debugMetadata.cachePrefixDiagnostics.largestChangedSections.map((item) => ({ ...item })) } : undefined,
      mainRequestMode: entry.debugMetadata.mainRequestMode, irminsulRecallPreview: entry.debugMetadata.irminsulRecallPreview,
      irminsulRecallRawText: entry.debugMetadata.irminsulRecallRawText, irminsulRecallUsedModel: entry.debugMetadata.irminsulRecallUsedModel,
      codexRecallPreview: entry.debugMetadata.codexRecallPreview, codexRecallInjection: entry.debugMetadata.codexRecallInjection,
      codexRecallRawText: entry.debugMetadata.codexRecallRawText, codexRecallUsedModel: entry.debugMetadata.codexRecallUsedModel,
    } : undefined,
    narrativeImages: entry.narrativeImages?.map((image) => ({ ...image })),
  }));
}

function withLegacyChat(game: TeyvatGameState, messages: 聊天消息[]): TeyvatGameState {
  return {
    ...game,
    对话: normalizeConversationLog({ entries: messages.map((message) => ({
      id: message.id, role: message.role, content: message.content, timestamp: message.timestamp,
      gameTime: message.gameTime,
      structuredResponse: message.parsedResponse ? {
        body: message.parsedResponse.body.map((block) => ({ ...block })),
        choices: message.parsedResponse.choices.map((choice) => ({ ...choice })),
        factCandidates: message.parsedResponse.factCandidates.map((candidate) => ({ ...candidate })),
        continuation: {
          summary: message.parsedResponse.continuation.summary,
          unresolved: [...message.parsedResponse.continuation.unresolved],
        },
      } : undefined,
      preTurnState: message.preTurnSnapshot ? fromLegacyTurnCheckpoint(message.preTurnSnapshot) : undefined,
      tokenUsage: message.tokenUsage ? {
        inputTokens: message.tokenUsage.inputTokens, outputTokens: message.tokenUsage.outputTokens, totalTokens: message.tokenUsage.totalTokens,
        cachedTokens: message.tokenUsage.cachedTokens, uncachedTokens: message.tokenUsage.uncachedTokens, cacheHitRate: message.tokenUsage.cacheHitRate,
        source: message.tokenUsage.source, provider: message.tokenUsage.provider, model: message.tokenUsage.model,
        usageFormat: message.tokenUsage.usageFormat, usagePath: message.tokenUsage.usagePath, rawUsageKeys: [...(message.tokenUsage.rawUsageKeys ?? [])],
        system: message.tokenUsage.system, cacheDiagnostic: message.tokenUsage.cacheDiagnostic,
      } : undefined,
      debugMetadata: message.debugContext ? {
        systemPrompt: message.debugContext.systemPrompt, messages: message.debugContext.messages.map((item) => ({ role: item.role, content: item.content })),
        recallPreview: message.debugContext.recallPreview, recallSummary: message.debugContext.recallSummary, recallFullContent: message.debugContext.recallFullContent,
        deepSeekMainMode: message.debugContext.deepSeekMainMode, deepSeekCotFakeHistorySkipped: message.debugContext.deepSeekCotFakeHistorySkipped,
        deepSeekPrefixMode: message.debugContext.deepSeekPrefixMode, deepSeekProtocolIssues: [...(message.debugContext.deepSeekProtocolIssues ?? [])],
        deepSeekMainOriginalModel: message.debugContext.deepSeekMainOriginalModel, deepSeekMainAdaptedModel: message.debugContext.deepSeekMainAdaptedModel,
        stV2Attempted: message.debugContext.stV2Attempted, stV2Used: message.debugContext.stV2Used, stV2FallbackReason: message.debugContext.stV2FallbackReason,
        rerollSimilarity: message.debugContext.rerollSimilarity, rerollSimilarityRetried: message.debugContext.rerollSimilarityRetried,
        cachePrefixDiagnostics: message.debugContext.cachePrefixDiagnostics ? { ...message.debugContext.cachePrefixDiagnostics, largestChangedSections: message.debugContext.cachePrefixDiagnostics.largestChangedSections.map((item) => ({ label: item.label, tokens: item.tokens })) } : undefined,
        mainRequestMode: message.debugContext.mainRequestMode, irminsulRecallPreview: message.debugContext.irminsulRecallPreview,
        irminsulRecallRawText: message.debugContext.irminsulRecallRawText, irminsulRecallUsedModel: message.debugContext.irminsulRecallUsedModel,
        codexRecallPreview: message.debugContext.codexRecallPreview, codexRecallInjection: message.debugContext.codexRecallInjection,
        codexRecallRawText: message.debugContext.codexRecallRawText, codexRecallUsedModel: message.debugContext.codexRecallUsedModel,
      } : undefined,
      inputTokens: message.inputTokens, outputTokens: message.outputTokens, responseDurationSec: message.responseDurationSec,
      streaming: message.isStreaming, bookmark: message.bookmark ? { title: message.bookmark.title, note: message.bookmark.note, createdAt: message.bookmark.createdAt } : undefined,
      narrativeImages: message.narrativeImages?.map((image) => ({ id: image.id, dataUrl: image.dataUrl, type: image.type, kind: image.kind, prompt: image.prompt, negativePrompt: image.negativePrompt, description: image.description, status: image.status, error: image.error, assetId: image.assetId })),
    })) }),
  };
}

function toLegacyMemory(game: TeyvatGameState): 记忆系统 {
  return { 即时记忆: [...game.记忆.immediate], 短期记忆: [...game.记忆.shortTerm], 中期记忆: [...game.记忆.mediumTerm], 长期记忆: [...game.记忆.longTerm], 失败草稿: game.记忆.failedDrafts.map((draft) => ({
    id: draft.id, origin: draft.origin, kind: draft.kind, status: draft.status,
    sourceTurns: { start: draft.sourceTurns.start, end: draft.sourceTurns.end },
    sourceSnapshot: { encoding: draft.sourceSnapshot.encoding, payload: draft.sourceSnapshot.payload, checksum: draft.sourceSnapshot.checksum, itemCount: draft.sourceSnapshot.itemCount, uncompressedBytes: draft.sourceSnapshot.uncompressedBytes },
    targetLayer: draft.targetLayer, fallbackSummary: draft.fallbackSummary, failureCode: draft.failureCode,
    failureMessage: draft.failureMessage, attemptCount: draft.attemptCount, createdAt: draft.createdAt, updatedAt: draft.updatedAt,
  })) };
}

function withLegacyMemory(game: TeyvatGameState, memory: 记忆系统): TeyvatGameState {
  return { ...game, 记忆: normalizeMemoryLedger({
    immediate: memory.即时记忆, shortTerm: memory.短期记忆, mediumTerm: memory.中期记忆, longTerm: memory.长期记忆,
    failedDrafts: (memory.失败草稿 ?? []).map((draft) => ({
      id: draft.id, origin: draft.origin, kind: draft.kind, status: draft.status,
      sourceTurns: { start: draft.sourceTurns.start, end: draft.sourceTurns.end },
      sourceSnapshot: { encoding: draft.sourceSnapshot.encoding, payload: draft.sourceSnapshot.payload, checksum: draft.sourceSnapshot.checksum, itemCount: draft.sourceSnapshot.itemCount, uncompressedBytes: draft.sourceSnapshot.uncompressedBytes },
      targetLayer: draft.targetLayer, fallbackSummary: draft.fallbackSummary, failureCode: draft.failureCode,
      failureMessage: draft.failureMessage, attemptCount: draft.attemptCount, createdAt: draft.createdAt, updatedAt: draft.updatedAt,
    })), recoveryLog: game.记忆.recoveryLog,
  }) };
}

function applyLegacyIrminsul(game: TeyvatGameState, yiting: 旧世界树系统): TeyvatGameState {
  const typeMap = { 短期压缩: 'short', 中期压缩: 'medium', 长期压缩: 'long', 精炼纪要: 'refined' } as const;
  return { ...game, 世界树: { entries: yiting.回忆档案.map((entry) => ({
    id: entry.id, title: entry.名称 ?? '', summary: entry.摘要, sourceText: entry.原文,
    keywords: [...(entry.检索关键词 ?? [])], sourceTurns: [...(entry.来源回合 ?? [entry.回合])],
    turn: entry.回合, recordedAt: entry.时间戳, archiveType: typeMap[entry.类型 ?? '短期压缩'],
  })) } };
}

function applyLegacyCodex(game: TeyvatGameState, codex: 旧图鉴系统): TeyvatGameState {
  const entries = codex.条目.map((entry) => ({
    id: entry.id, category: entry.分类, name: entry.标题, description: entry.摘要,
    unlockedAtTurn: 0, tags: [...entry.关键词], summary: entry.摘要, sourceText: entry.原文,
    source: entry.来源 ?? '', keywords: [...entry.关键词], triggerKeywords: [...(entry.触发关键词 ?? [])],
    injection: entry.注入内容?.类型 === 'character' ? {
      type: 'character' as const, identityAndFaction: entry.注入内容.核心身份与阵营, personalityAndBehavior: entry.注入内容.独立人格与行为,
      speechStyle: entry.注入内容.说话方式, dialogueSamples: entry.注入内容.台词语料, appearanceAnchor: entry.注入内容.外貌锚点,
      currentFormAndLimits: entry.注入内容.当前形态与能力边界, conciseStory: entry.注入内容.精简角色故事, portrayalBoundaries: entry.注入内容.演绎红线,
    } : entry.注入内容?.类型 === 'lore' ? {
      type: 'lore' as const, definition: entry.注入内容.核心定义, facts: entry.注入内容.关键事实,
      narrativeUse: entry.注入内容.叙事用途, boundaries: entry.注入内容.演绎边界,
    } : {},
    runtimeUnlock: { status: entry.运行时解锁状态 ?? entry.解锁状态 ?? '', note: entry.运行时解锁备注 ?? '', ...(entry.解锁条件 ? { condition: entry.解锁条件 } : {}) },
    usage: { narrative: entry.可否主剧情注入 === true, courier: entry.可否信使使用 === true, steambird: entry.可否蒸汽鸟报使用 === true, variables: entry.可否变量参考 === true },
    relatedEntryIds: [...entry.关联条目ID], importance: entry.重要度, linkable: entry.可用于联动,
    builtin: entry.builtin, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
  }));
  return { ...game, 图鉴: { entries, unlockedEntryIds: entries.filter((entry) => entry.runtimeUnlock.status && entry.runtimeUnlock.status !== '未解锁').map((entry) => entry.id) } };
}


export function mapTeyvatNpcsToLegacy(game: TeyvatGameState): NPC记录[] {
  return game.NPC.map((npc) => ({
    id: npc.id, 姓名: npc.姓名, 别名: npc.aliases[0], 阶位: npc.roleTier, 好感度: npc.affinity,
    关系: npc.relationship as NPC记录['关系'], 亲密关系: npc.intimate, 同行: npc.travelingTogether,
    初见回合: npc.firstSeenTurn, 最近回合: npc.lastSeenTurn, 性别: npc.gender as NPC记录['性别'],
    对玩家称呼: npc.playerAddress, 外貌: npc.appearance, 穿着: npc.clothing, 说话方式: npc.speechStyle,
    性格: npc.personality, 介绍: npc.说明, 装备摘要: npc.equipmentSummary,
    同行记忆: npc.sharedMemories.map((memory) => ({ id: memory.id, 回合: memory.turn, 摘要: memory.summary, 原文: memory.sourceText, 来源: ({ narrative: '正文', courier: '手机', steambird: '蒸汽鸟报', variable: '变量', other: '其他' } as const)[memory.source ?? 'other'], 关联NPCID: [...memory.relatedNpcIds] })),
    最近互动: npc.relationshipLedger.recentInteraction, 对玩家长期印象: npc.relationshipLedger.longTermImpression,
    当前关系阶段: npc.relationshipLedger.currentStage, 共同经历: npc.relationshipLedger.sharedExperiences,
    未完成事项: npc.relationshipLedger.unfinishedBusiness, 未解决冲突: npc.relationshipLedger.unresolvedConflicts,
    必须记得: npc.relationshipLedger.mustRemember, 禁止遗忘: npc.relationshipLedger.protectedFacts,
    总结记忆: npc.relationshipLedger.summaries.map((memory) => ({ id: memory.id, 回合范围: memory.turnRange, 条数: memory.itemCount, 摘要: memory.summary, 保留事实: [...memory.retainedFacts], 关系变化: [...memory.relationshipChanges], 未完成事项: [...memory.unfinishedBusiness] })),
    备注: npc.notes, 玩家纠正记录: npc.playerCorrections, 原著角色: npc.canonical,
    NSFW档案: npc.matureArchive ? {
      enabled: npc.matureArchive.enabled, 年龄确认: npc.matureArchive.ageConfirmation, 亲密阶段: npc.matureArchive.intimacyStage,
      是否处女: npc.gender === '女' && npc.matureArchive.ageConfirmation === 'adult' ? (npc.matureArchive.virginityStatus === 'virgin' ? '是' : npc.matureArchive.virginityStatus === 'not_virgin' ? '否' : npc.matureArchive.virginityStatus === 'unknown' ? '未知' : undefined) : undefined,
      首次性行为对象: npc.gender === '女' && npc.matureArchive.ageConfirmation === 'adult' ? npc.matureArchive.firstSexualPartner : undefined,
      边界: npc.matureArchive.boundaries, 偏好: [...npc.matureArchive.preferences], 敏感点: [...npc.matureArchive.sensitivePoints], 禁忌: [...npc.matureArchive.taboos],
      女性身体档案: { 胸部: npc.matureArchive.femaleBodyProfile.chest, 女性私处: npc.matureArchive.femaleBodyProfile.genital, 后庭: npc.matureArchive.femaleBodyProfile.rear, 体态: npc.matureArchive.femaleBodyProfile.build, 体味: npc.matureArchive.femaleBodyProfile.scent },
      男性身体档案: { 男性器: npc.matureArchive.maleBodyProfile.genital, 后庭: npc.matureArchive.maleBodyProfile.rear, 体态: npc.matureArchive.maleBodyProfile.build, 体味: npc.matureArchive.maleBodyProfile.scent },
      经历: [...npc.matureArchive.experiences], 长期事实: [...npc.matureArchive.longTermFacts], 标签: [...npc.matureArchive.tags],
      部位图片: { 女性胸部: npc.matureArchive.partImages.femaleChest, 女性私处: npc.matureArchive.partImages.femaleGenital, 男性器: npc.matureArchive.partImages.maleGenital, 后庭: npc.matureArchive.partImages.rear, 体态参考: npc.matureArchive.partImages.bodyReference }, 备注: npc.matureArchive.notes,
    } : undefined,
    图像档案: { 头像: npc.visualArchive.profileImage, 立绘: npc.visualArchive.fullPortrait, 头像槽位: { 档案: npc.visualArchive.slotImages.profile, 正文: npc.visualArchive.slotImages.narrative, 手机: npc.visualArchive.slotImages.courier }, 头像提示词: npc.visualArchive.profilePrompt, 立绘提示词: npc.visualArchive.portraitPrompt, 状态: npc.visualArchive.status, 来源: ({ manual: '手动', canon: '原著', generated: '文生图', placeholder: '占位' } as const)[npc.visualArchive.source ?? 'manual'] }, 头像: npc.avatar,
  }));
}

export function applyLegacyNpcRecords(game: TeyvatGameState, records: NPC记录[]): TeyvatGameState {
  const existingById = new Map(game.NPC.map((npc) => [npc.id, npc]));
  const NPC = normalizeTeyvatNpcRecords(records.map((npc) => {
    const existing = existingById.get(npc.id);
    return {
    id: npc.id, 姓名: npc.姓名, 地区: existing?.地区 ?? '', 身份: existing?.身份 ?? npc.介绍 ?? '',
    ...(existing?.元素 ? { 元素: existing.元素 } : {}),
    ...(existing?.力量来源 ? { 力量来源: existing.力量来源 } : {}),
    天赋: existing?.天赋.map((talent) => ({ ...talent })) ?? [], 说明: npc.介绍 ?? existing?.说明 ?? '',
    aliases: npc.别名 ? [npc.别名] : [], roleTier: npc.阶位, affinity: npc.好感度, relationship: npc.关系,
    intimate: npc.亲密关系 === true, travelingTogether: npc.同行, firstSeenTurn: npc.初见回合, lastSeenTurn: npc.最近回合,
    gender: npc.性别 ?? '', playerAddress: npc.对玩家称呼 ?? '', appearance: npc.外貌 ?? '', clothing: npc.穿着 ?? '',
    speechStyle: npc.说话方式 ?? '', personality: npc.性格 ?? '', equipmentSummary: npc.装备摘要 ?? '',
    sharedMemories: (npc.同行记忆 ?? []).map((memory) => ({ id: memory.id, turn: memory.回合, summary: memory.摘要, sourceText: memory.原文, source: ({ 正文: 'narrative', 手机: 'courier', 蒸汽鸟报: 'steambird', 变量: 'variable', 其他: 'other' } as const)[memory.来源 ?? '其他'], relatedNpcIds: [...(memory.关联NPCID ?? [])] })),
    relationshipLedger: {
      recentInteraction: npc.最近互动 ?? '', longTermImpression: npc.对玩家长期印象 ?? '', currentStage: npc.当前关系阶段 ?? '',
      sharedExperiences: [...(npc.共同经历 ?? [])], unfinishedBusiness: [...(npc.未完成事项 ?? [])],
      unresolvedConflicts: [...(npc.未解决冲突 ?? [])], mustRemember: [...(npc.必须记得 ?? [])],
      protectedFacts: [...(npc.禁止遗忘 ?? [])], summaries: (npc.总结记忆 ?? []).map((memory) => ({ id: memory.id, turnRange: memory.回合范围, itemCount: memory.条数, summary: memory.摘要, retainedFacts: [...(memory.保留事实 ?? [])], relationshipChanges: [...(memory.关系变化 ?? [])], unfinishedBusiness: [...(memory.未完成事项 ?? [])] })),
    },
    notes: [...npc.备注], playerCorrections: [...(npc.玩家纠正记录 ?? [])], canonical: npc.原著角色 === true,
    avatar: npc.头像 ?? '', visualArchive: npc.图像档案 ? {
      profileImage: npc.图像档案.头像, fullPortrait: npc.图像档案.立绘,
      slotImages: { profile: npc.图像档案.头像槽位?.档案, narrative: npc.图像档案.头像槽位?.正文, courier: npc.图像档案.头像槽位?.手机 },
      profilePrompt: npc.图像档案.头像提示词, portraitPrompt: npc.图像档案.立绘提示词, status: npc.图像档案.状态,
      source: ({ 手动: 'manual', 原著: 'canon', 文生图: 'generated', 占位: 'placeholder' } as const)[npc.图像档案.来源 ?? '手动'],
    } : { slotImages: {} },
    matureArchive: npc.NSFW档案 ? {
      enabled: npc.NSFW档案.enabled, ageConfirmation: npc.NSFW档案.年龄确认, intimacyStage: npc.NSFW档案.亲密阶段,
      virginityStatus: npc.性别 === '女' && npc.NSFW档案.年龄确认 === 'adult' ? (npc.NSFW档案.是否处女 === '是' ? 'virgin' : npc.NSFW档案.是否处女 === '否' ? 'not_virgin' : npc.NSFW档案.是否处女 === '未知' ? 'unknown' : undefined) : undefined,
      firstSexualPartner: npc.性别 === '女' && npc.NSFW档案.年龄确认 === 'adult' ? npc.NSFW档案.首次性行为对象 : undefined,
      boundaries: npc.NSFW档案.边界, preferences: [...(npc.NSFW档案.偏好 ?? [])], sensitivePoints: [...(npc.NSFW档案.敏感点 ?? [])], taboos: [...(npc.NSFW档案.禁忌 ?? [])],
      femaleBodyProfile: { chest: npc.NSFW档案.女性身体档案?.胸部, genital: npc.NSFW档案.女性身体档案?.女性私处, rear: npc.NSFW档案.女性身体档案?.后庭, build: npc.NSFW档案.女性身体档案?.体态, scent: npc.NSFW档案.女性身体档案?.体味 },
      maleBodyProfile: { genital: npc.NSFW档案.男性身体档案?.男性器, rear: npc.NSFW档案.男性身体档案?.后庭, build: npc.NSFW档案.男性身体档案?.体态, scent: npc.NSFW档案.男性身体档案?.体味 },
      experiences: [...(npc.NSFW档案.经历 ?? [])], longTermFacts: [...(npc.NSFW档案.长期事实 ?? [])], tags: [...(npc.NSFW档案.标签 ?? [])],
      partImages: { femaleChest: npc.NSFW档案.部位图片?.女性胸部, femaleGenital: npc.NSFW档案.部位图片?.女性私处, maleGenital: npc.NSFW档案.部位图片?.男性器, rear: npc.NSFW档案.部位图片?.后庭, bodyReference: npc.NSFW档案.部位图片?.体态参考 }, notes: npc.NSFW档案.备注,
    } : null,
  }}));
  return { ...game, NPC, 手机: reconcileCourierContactsWithNpcs(game.手机, NPC) };
}

function applyLegacySteambird(game: TeyvatGameState, news: 旧报刊条目[]): TeyvatGameState {
  const section = { plan: 'notice', chronicle: 'local', starlog: 'world', frontline: 'investigation' } as const;
  const status = { upcoming: 'upcoming', ongoing: 'ongoing', completed: 'published', archived: 'archived' } as const;
  return { ...game, 蒸汽鸟报: { articles: news.map((article) => ({
    id: article.id, section: section[article.类目], status: status[article.状态], turn: article.回合,
    timestamp: article.时间戳, title: article.标题, body: article.正文, organizationTags: [...(article.组织标签 ?? [])],
    relatedSystems: [...(article.关联系统 ?? [])], narrativeSeriesId: article.关联剧情系列ID ?? '',
    narrativeSegmentId: article.关联剧情分段ID ?? '', important: article.重要 === true,
    createdAt: article.创建时间, updatedAt: article.更新时间,
  })) } };
}

function toLegacyAlbum(game: TeyvatGameState): 相册系统 {
  return 归一化相册系统({
    assets: game.相册.assets.map((asset) => ({ id: asset.id, url: asset.url, originalUrl: asset.originalUrl, dataUrl: asset.dataUrl, localRef: asset.localRef, contentHash: asset.contentHash, mimeType: asset.mimeType, width: asset.width, height: asset.height, size: asset.size, source: asset.source, nsfw: asset.nsfw, createdAt: asset.createdAt, prompt: asset.prompt, negativePrompt: asset.negativePrompt, sourcePrompt: asset.sourcePrompt, finalPrompt: asset.finalPrompt, finalNegativePrompt: asset.finalNegativePrompt, anchorMode: asset.anchorMode, anchorSummary: asset.anchorSummary, referenceImageIds: [...asset.referenceImageIds], dimensions: asset.dimensions, model: asset.model, backend: asset.backend, status: asset.status, error: asset.error })),
    entries: game.相册.entries.map((entry) => ({
      id: entry.id, assetId: entry.assetId ?? '', title: entry.title ?? entry.description,
      targetType: (entry.targetType ?? entry.kind) as never, targetId: entry.targetId,
      slot: (entry.slot ?? 'misc') as never, tags: [...(entry.tags ?? [])], nsfw: entry.nsfw === true,
      createdAt: entry.createdAt, note: entry.note, referenceTargets: [...(entry.referenceTargets ?? [])],
    })),
    tasks: game.相册.generationTasks.map((task) => ({ id: task.id, targetType: task.targetType, targetId: task.targetId, slot: task.slot, source: task.source, status: task.status, backend: task.backend, nsfw: task.nsfw, prompt: task.prompt, negativePrompt: task.negativePrompt, sourcePrompt: task.sourcePrompt, finalPrompt: task.finalPrompt, finalNegativePrompt: task.finalNegativePrompt, anchorMode: task.anchorMode, anchorSummary: task.anchorSummary, referenceImageIds: [...task.referenceImageIds], dimensions: task.dimensions, resultAssetId: task.resultAssetId, error: task.error, retryCount: task.retryCount, createdAt: task.createdAt, startedAt: task.startedAt, finishedAt: task.finishedAt })),
  });
}

function withLegacyAlbum(game: TeyvatGameState, album: 相册系统): TeyvatGameState {
  return { ...game, 相册: normalizeJourneyAlbum({
    assets: album.assets.map((asset) => ({ id: asset.id, url: asset.url, originalUrl: asset.originalUrl, dataUrl: asset.dataUrl, localRef: asset.localRef, contentHash: asset.contentHash, mimeType: asset.mimeType, width: asset.width, height: asset.height, size: asset.size, source: asset.source, nsfw: asset.nsfw, createdAt: asset.createdAt, prompt: asset.prompt, negativePrompt: asset.negativePrompt, sourcePrompt: asset.sourcePrompt, finalPrompt: asset.finalPrompt, finalNegativePrompt: asset.finalNegativePrompt, anchorMode: asset.anchorMode, anchorSummary: asset.anchorSummary, referenceImageIds: [...(asset.referenceImageIds ?? [])], dimensions: asset.dimensions, model: asset.model, backend: asset.backend, status: asset.status, error: asset.error })),
    entries: album.entries.map((entry) => ({
      id: entry.id, kind: entry.targetType === 'traveler' || entry.targetType === 'npc' ? 'character' : 'scene',
      url: '', prompt: '', description: entry.title, turn: 0, createdAt: entry.createdAt,
      assetId: entry.assetId, title: entry.title, targetType: entry.targetType, targetId: entry.targetId,
      slot: entry.slot, tags: [...entry.tags], nsfw: entry.nsfw, note: entry.note,
      referenceTargets: [...entry.referenceTargets],
    })),
    generationTasks: album.tasks.map((task) => ({ id: task.id, targetType: task.targetType, targetId: task.targetId, slot: task.slot, source: task.source, status: task.status, backend: task.backend, nsfw: task.nsfw, prompt: task.prompt, negativePrompt: task.negativePrompt, sourcePrompt: task.sourcePrompt, finalPrompt: task.finalPrompt, finalNegativePrompt: task.finalNegativePrompt, anchorMode: task.anchorMode, anchorSummary: task.anchorSummary, referenceImageIds: [...(task.referenceImageIds ?? [])], dimensions: task.dimensions, resultAssetId: task.resultAssetId, error: task.error, retryCount: task.retryCount, createdAt: task.createdAt, startedAt: task.startedAt, finishedAt: task.finishedAt })),
  }) };
}

function toLegacyQuest(game: TeyvatGameState): 任务系统 {
  const mapTask = (task: TeyvatGameState['任务']['active'][number]) => ({
    id: task.id, 标题: task.title, 描述: task.description,
    来源: ({ main: '主线', side: '支线', custom: '自定义', letter: '来信' } as const)[task.source],
    状态: ({ not_started: '未开始', active: '进行中', completed: '已完成', failed: '已失败', abandoned: '已放弃' } as const)[task.status],
    目标: task.objectives.map((objective) => ({
      id: objective.id, 类型: ({ reach: '达成', collect: '收集', talk: '交谈', travel: '前往', defeat: '击杀', time: '时间' } as const)[objective.type],
      描述: objective.description, 目标数量: objective.targetCount, 当前数量: objective.currentCount, 完成: objective.completed,
    })),
    奖励: task.rewards.map((reward) => ({ 类型: '物品' as const, 内容: reward })),
    创建回合: task.createdAtTurn, 更新时间: task.updatedAt, 完成回合: task.completedAtTurn, 备注: task.notes,
  });
  return { 进行中: game.任务.active.map(mapTask), 已完成: game.任务.completed.map(mapTask), 已放弃: game.任务.abandoned.map(mapTask), 上一轮任务更新: [...game.任务.lastUpdates] };
}

function withLegacyQuest(game: TeyvatGameState, quest: 任务系统): TeyvatGameState {
  const mapTask = (task: 任务系统['进行中'][number]) => ({
    id: task.id, title: task.标题, description: task.描述,
    source: ({ 主线: 'main', 支线: 'side', 自定义: 'custom', 来信: 'letter' } as const)[task.来源],
    status: ({ 未开始: 'not_started', 进行中: 'active', 已完成: 'completed', 已失败: 'failed', 已放弃: 'abandoned' } as const)[task.状态],
    objectives: task.目标.map((objective) => ({
      id: objective.id, type: ({ 达成: 'reach', 收集: 'collect', 交谈: 'talk', 前往: 'travel', 击杀: 'defeat', 时间: 'time' } as const)[objective.类型],
      description: objective.描述, targetCount: objective.目标数量, currentCount: objective.当前数量, completed: objective.完成,
    })),
    rewards: task.奖励.map((reward) => reward.内容), createdAtTurn: task.创建回合,
    updatedAt: task.更新时间, completedAtTurn: task.完成回合, notes: task.备注,
  });
  return { ...game, 任务: { active: quest.进行中.map(mapTask), completed: quest.已完成.map(mapTask), abandoned: quest.已放弃.map(mapTask), lastUpdates: [...quest.上一轮任务更新] } };
}

function toLegacyQueue(game: TeyvatGameState): 队列任务记录[] {
  return game.后台队列.tasks.map((task) => ({
    id: task.id as 队列任务记录['id'], title: task.title, subtitle: task.subtitle, turn: task.turn,
    timestamp: task.timestamp, status: task.status, detail: task.detail, rawText: task.rawText,
    targetMessageId: task.targetMessageId, targetBatchId: task.targetBatchId, retryHint: task.retryHint,
    failCount: task.retryCount, retrying: task.retrying, cancellable: task.cancellable,
    cancelled: task.cancelled,
  }));
}

function withLegacyQueue(game: TeyvatGameState, tasks: 队列任务记录[]): TeyvatGameState {
  return { ...game, 后台队列: { tasks: tasks.map((task) => ({
    id: task.id, title: task.title, subtitle: task.subtitle, turn: task.turn, timestamp: task.timestamp,
    status: task.status, detail: task.detail, rawText: task.rawText, targetMessageId: task.targetMessageId,
    targetBatchId: task.targetBatchId, retryHint: task.retryHint, retryCount: task.failCount,
    retrying: task.retrying, cancellable: task.cancellable, cancelled: task.cancelled,
  })) } };
}

function fromLegacyPlot(nodes: 剧情节点[]): TeyvatGameState['叙事']['plotNodes'] {
  return normalizeNarrativeRuntime({ plotNodes: nodes.map((node) => ({
    id: node.id, title: node.标题, summary: node.摘要, status: node.状态,
    createdAtTurn: node.创建回合, updatedAtTurn: node.更新回合,
    prerequisiteNodeId: node.前置节点ID, guidance: node.AI引导,
  })) }).plotNodes;
}

function toLegacyPlot(nodes: TeyvatGameState['叙事']['plotNodes']): 剧情节点[] {
  return nodes.map((node) => ({ id: node.id, 标题: node.title, 摘要: node.summary, 状态: node.status,
    创建回合: node.createdAtTurn, 更新回合: node.updatedAtTurn, 前置节点ID: node.prerequisiteNodeId, AI引导: node.guidance }));
}

export function fromLegacyStoryWeaving(story: 剧情编织系统): NonNullable<TeyvatGameState['叙事']['storyWeaving']> {
  const statusMap = { 待处理: 'pending', 处理中: 'processing', 已完成: 'completed', 失败: 'failed' } as const;
  const runtimeMap = { 未开始: 'not_started', 当前: 'current', 已经历: 'experienced', 已跳过: 'skipped', 已偏离: 'diverged', 暂停: 'paused' } as const;
  const normalized = normalizeNarrativeRuntime({ storyWeaving: {
    series: story.系列列表.map((series) => ({
      id: series.id, title: series.标题, workTitle: series.作品名, sourceType: series.来源类型,
      sourceCodexEntryIds: [...series.来源图鉴条目ID], builtinPresetId: series.内置预设ID,
      sourceFileName: series.来源文件名, sourceText: series.原始文本,
      chapters: series.章节列表.map((chapter) => ({ id: chapter.id, index: chapter.序号, title: chapter.标题, content: chapter.内容, characterCount: chapter.字数 })),
      segments: series.分段列表.map((segment) => ({
        id: segment.id, group: segment.组号, title: segment.标题, chapterRange: segment.章节范围, chapterTitles: [...segment.章节标题], opening: segment.是否开局组,
        startChapter: segment.起始章序号, endChapter: segment.结束章序号, injectionEnabled: segment.启用注入, sourceText: segment.原文内容, characterCount: segment.字数,
        sourceSummary: segment.原文摘要, stageSummary: segment.本段概括, timelineStart: segment.时间线起点, timelineEnd: segment.时间线终点,
        establishedFacts: [...segment.开局已成立事实], continuedFacts: [...segment.前段延续事实], endState: [...segment.本段结束状态], futureReferences: [...segment.给后续参考], characters: [...segment.登场角色], locations: [...segment.涉及地点], factions: [...segment.涉及派系],
        canonConstraints: segment.原著硬约束.map((entry) => ({ content: entry.内容, visibility: { knownBy: [...entry.信息可见性.谁知道], unknownBy: [...entry.信息可见性.谁不知道], readerOnly: entry.信息可见性.是否仅读者视角可见 } })),
        foreshadowing: segment.可提前铺垫.map((entry) => ({ content: entry.内容, visibility: { knownBy: [...entry.信息可见性.谁知道], unknownBy: [...entry.信息可见性.谁不知道], readerOnly: entry.信息可见性.是否仅读者视角可见 } })),
        characterProfiles: segment.角色档案.map((profile) => ({ name: profile.名称, identity: profile.身份, faction: profile.所属势力, initialPosition: profile.初始立场, relationshipSummary: [...profile.关系摘要], stateSummary: [...profile.状态摘要], firstAppearance: profile.首次出现, importance: profile.重要性 === '核心' ? 'core' : profile.重要性 === '重要' ? 'important' : 'ordinary' })),
        factionProfiles: segment.势力档案.map((profile) => ({ name: profile.名称, type: profile.类型, territory: profile.地盘, representatives: [...profile.代表人物], goals: profile.立场目标, currentState: profile.当前状态, relationshipSummary: [...profile.关系摘要], firstAppearance: profile.首次出现 })),
        locationProfiles: segment.地图地点档案.map((profile) => ({ name: profile.名称, level: ({ 寰宇: 'universe', 大地点: 'major', 中地点: 'medium', 小地点: 'minor', 区地点: 'district', 子地点: 'sub_location', 未知: 'unknown' } as const)[profile.层级], parentLocation: profile.上级地点, faction: profile.所属势力, function: profile.地貌功能, facilities: [...profile.关键设施], firstAppearance: profile.首次出现 })),
        keyEvents: segment.关键事件.map((event) => ({ name: event.事件名, description: event.事件说明, prerequisites: [...event.前置条件], triggers: [...event.触发条件], blockers: [...event.阻断条件], results: [...event.事件结果], laterEffects: [...event.对后续影响], visibility: { knownBy: [...event.信息可见性.谁知道], unknownBy: [...event.信息可见性.谁不知道], readerOnly: event.信息可见性.是否仅读者视角可见 } })),
        timeline: segment.时间线.map((event) => ({ title: event.标题, timeAnchor: event.时间锚点, description: event.描述, characters: [...event.涉及角色] })),
        characterProgress: segment.角色推进.map((progress) => ({ characterName: progress.角色名, beforeState: [...progress.本段前状态], changes: [...progress.本段变化], afterState: [...progress.本段后状态], laterEffects: [...progress.对后续影响] })),
        processingStatus: statusMap[segment.处理状态], runtimeStatus: runtimeMap[segment.运行状态], lastError: segment.最近错误, updatedAt: segment.updatedAt,
      })),
      chaptersPerSegment: series.每段章数, active: series.激活注入, currentSegmentGroup: series.当前分段组号,
      currentStageSummary: series.当前阶段概括, coreCharacterSummary: [...series.核心角色摘要], coreCharacters: [...series.核心角色],
      locationIndex: [...series.涉及地点索引], factionIndex: [...series.涉及派系索引], createdAt: series.createdAt, updatedAt: series.updatedAt,
    })), activeSeriesId: story.当前系列ID,
    progress: story.当前进度 ? {
      seriesId: story.当前进度.当前系列ID, segmentId: story.当前进度.当前分段ID, segmentGroup: story.当前进度.当前分段组号,
      status: ({ 未开始: 'not_started', 推进中: 'progressing', 已完成: 'completed', 已偏离: 'diverged', 暂停: 'paused' } as const)[story.当前进度.推进状态],
      completedSummaries: [...story.当前进度.已完成摘要], openQuestions: [...story.当前进度.当前待解问题], switchNotes: [...story.当前进度.切换说明],
      archive: story.当前进度.历史归档.map((entry) => ({ id: entry.id, seriesId: entry.系列ID, segmentId: entry.分段ID, segmentGroup: entry.分段组号, segmentTitle: entry.分段标题, archivedAtTurn: entry.归档回合, status: ({ 已经历: 'experienced', 已跳过: 'skipped', 已偏离: 'diverged', 已完成: 'completed' } as const)[entry.归档状态], summary: entry.摘要, characterProgress: [...(entry.角色推进摘要 ?? [])], switchNotes: entry.切换说明, reasons: [...entry.判定理由], createdAt: entry.createdAt })),
      gate: story.当前进度.最近门禁结果, reasons: [...story.当前进度.最近判定理由], lastDecisionTurn: story.当前进度.最近一次推进判定回合,
      evidence: [...(story.当前进度.推进证据 ?? [])], consecutiveEvidenceTurns: story.当前进度.连续推进证据回合 ?? 0, stalledTurns: story.当前进度.卡段回合数 ?? 0, updatedAt: story.当前进度.updatedAt,
    } : undefined,
  } });
  return normalized.storyWeaving ?? { series: [] };
}

export function toLegacyStoryWeaving(story: TeyvatGameState['叙事']['storyWeaving']): 剧情编织系统 {
  if (!story) return 创建空剧情编织系统();
  const statusMap = { pending: '待处理', processing: '处理中', completed: '已完成', failed: '失败' } as const;
  const runtimeMap = { not_started: '未开始', current: '当前', experienced: '已经历', skipped: '已跳过', diverged: '已偏离', paused: '暂停' } as const;
  return 归一化剧情编织系统({
    系列列表: story.series.map((series) => ({
      id: series.id, 标题: series.title, 作品名: series.workTitle, 来源类型: series.sourceType,
      来源图鉴条目ID: [...series.sourceCodexEntryIds], 内置预设ID: series.builtinPresetId, 来源文件名: series.sourceFileName, 原始文本: series.sourceText,
      章节列表: series.chapters.map((chapter) => ({ id: chapter.id, 序号: chapter.index, 标题: chapter.title, 内容: chapter.content, 字数: chapter.characterCount })),
      分段列表: series.segments.map((segment) => ({
        id: segment.id, 组号: segment.group, 标题: segment.title, 章节范围: segment.chapterRange, 章节标题: [...segment.chapterTitles], 是否开局组: segment.opening,
        起始章序号: segment.startChapter, 结束章序号: segment.endChapter, 启用注入: segment.injectionEnabled, 原文内容: segment.sourceText, 字数: segment.characterCount,
        原文摘要: segment.sourceSummary, 本段概括: segment.stageSummary, 时间线起点: segment.timelineStart, 时间线终点: segment.timelineEnd,
        开局已成立事实: [...segment.establishedFacts], 前段延续事实: [...segment.continuedFacts], 本段结束状态: [...segment.endState], 给后续参考: [...segment.futureReferences],
        原著硬约束: segment.canonConstraints.map((entry) => ({ 内容: entry.content, 信息可见性: { 谁知道: [...entry.visibility.knownBy], 谁不知道: [...entry.visibility.unknownBy], 是否仅读者视角可见: entry.visibility.readerOnly } })),
        可提前铺垫: segment.foreshadowing.map((entry) => ({ 内容: entry.content, 信息可见性: { 谁知道: [...entry.visibility.knownBy], 谁不知道: [...entry.visibility.unknownBy], 是否仅读者视角可见: entry.visibility.readerOnly } })),
        登场角色: [...segment.characters], 涉及地点: [...segment.locations], 涉及派系: [...segment.factions],
        角色档案: segment.characterProfiles.map((profile) => ({ 名称: profile.name, 身份: profile.identity, 所属势力: profile.faction, 初始立场: profile.initialPosition, 关系摘要: [...profile.relationshipSummary], 状态摘要: [...profile.stateSummary], 首次出现: profile.firstAppearance, 重要性: ({ ordinary: '一般', important: '重要', core: '核心' } as const)[profile.importance] })),
        势力档案: segment.factionProfiles.map((profile) => ({ 名称: profile.name, 类型: profile.type, 地盘: profile.territory, 代表人物: [...profile.representatives], 立场目标: profile.goals, 当前状态: profile.currentState, 关系摘要: [...profile.relationshipSummary], 首次出现: profile.firstAppearance })),
        地图地点档案: segment.locationProfiles.map((profile) => ({ 名称: profile.name, 层级: ({ universe: '寰宇', major: '大地点', medium: '中地点', minor: '小地点', district: '区地点', sub_location: '子地点', unknown: '未知' } as const)[profile.level], 上级地点: profile.parentLocation, 所属势力: profile.faction, 地貌功能: profile.function, 关键设施: [...profile.facilities], 首次出现: profile.firstAppearance })),
        关键事件: segment.keyEvents.map((event) => ({ 事件名: event.name, 事件说明: event.description, 前置条件: [...event.prerequisites], 触发条件: [...event.triggers], 阻断条件: [...event.blockers], 事件结果: [...event.results], 对后续影响: [...event.laterEffects], 信息可见性: { 谁知道: [...event.visibility.knownBy], 谁不知道: [...event.visibility.unknownBy], 是否仅读者视角可见: event.visibility.readerOnly } })),
        时间线: segment.timeline.map((event) => ({ 标题: event.title, 时间锚点: event.timeAnchor, 描述: event.description, 涉及角色: [...event.characters] })),
        角色推进: segment.characterProgress.map((progress) => ({ 角色名: progress.characterName, 本段前状态: [...progress.beforeState], 本段变化: [...progress.changes], 本段后状态: [...progress.afterState], 对后续影响: [...progress.laterEffects] })),
        处理状态: statusMap[segment.processingStatus], 运行状态: runtimeMap[segment.runtimeStatus], 最近错误: segment.lastError, updatedAt: segment.updatedAt,
      })),
      每段章数: series.chaptersPerSegment, 激活注入: series.active, 当前分段组号: series.currentSegmentGroup,
      当前阶段概括: series.currentStageSummary, 核心角色摘要: [...series.coreCharacterSummary], 核心角色: [...series.coreCharacters],
      涉及地点索引: [...series.locationIndex], 涉及派系索引: [...series.factionIndex], createdAt: series.createdAt, updatedAt: series.updatedAt,
    })), 当前系列ID: story.activeSeriesId,
    当前进度: story.progress ? {
      当前系列ID: story.progress.seriesId, 当前分段ID: story.progress.segmentId, 当前分段组号: story.progress.segmentGroup,
      推进状态: ({ not_started: '未开始', progressing: '推进中', completed: '已完成', diverged: '已偏离', paused: '暂停' } as const)[story.progress.status],
      已完成摘要: [...story.progress.completedSummaries], 当前待解问题: [...story.progress.openQuestions], 切换说明: [...story.progress.switchNotes],
      历史归档: story.progress.archive.map((entry) => ({ id: entry.id, 系列ID: entry.seriesId, 分段ID: entry.segmentId, 分段组号: entry.segmentGroup, 分段标题: entry.segmentTitle, 归档回合: entry.archivedAtTurn, 归档状态: ({ experienced: '已经历', skipped: '已跳过', diverged: '已偏离', completed: '已完成' } as const)[entry.status], 摘要: entry.summary, 角色推进摘要: [...entry.characterProgress], 切换说明: entry.switchNotes, 判定理由: [...entry.reasons], createdAt: entry.createdAt })),
      最近门禁结果: story.progress.gate, 最近判定理由: [...story.progress.reasons], 最近一次推进判定回合: story.progress.lastDecisionTurn,
      推进证据: [...story.progress.evidence], 连续推进证据回合: story.progress.consecutiveEvidenceTurns, 卡段回合数: story.progress.stalledTurns, updatedAt: story.progress.updatedAt,
    } : undefined,
  });
}

export function fromLegacyVariableBatches(batches: 变量命令批次[]): TeyvatGameState['叙事']['variableBatches'] {
  return normalizeNarrativeRuntime({ variableBatches: batches.map((batch) => ({
    id: batch.id, turn: batch.turn, timestamp: batch.timestamp, source: batch.source, modelName: batch.modelName,
    results: batch.results.map((result) => ({ command: { action: result.command.action, key: result.command.key, value: normalizeTechnicalJsonValue(result.command.value) }, ok: result.ok, kind: result.kind, reason: result.reason, evidence: result.evidence })),
    report: batch.report, rawText: batch.rawText, retentionSummary: batch.retentionSummary ? { ...batch.retentionSummary } : undefined,
  })) }).variableBatches;
}

export function toLegacyVariableBatches(batches: TeyvatGameState['叙事']['variableBatches']): 变量命令批次[] {
  return batches.map((batch) => ({ id: batch.id, turn: batch.turn, timestamp: batch.timestamp, source: batch.source, modelName: batch.modelName,
    results: batch.results.map((result) => ({ command: { action: result.command.action, key: result.command.key, value: technicalJsonToLegacy(result.command.value) }, ok: result.ok, kind: result.kind, reason: result.reason, evidence: result.evidence })),
    report: batch.report, rawText: batch.rawText, retentionSummary: batch.retentionSummary ? { ...batch.retentionSummary } : undefined }));
}

export interface LegacyGameStateOverrides {
  turnCount?: number;
  chatHistory?: 聊天消息[];
  记忆?: 记忆系统;
  世界?: 世界状态;
  旅人?: 角色数据结构;
  背包?: TeyvatInventory;
  NPC?: NPC记录[];
  手机?: CourierSystem;
  相册?: 相册系统;
  剧情?: 剧情节点[];
  剧情编织?: 剧情编织系统;
  variableBatches?: 变量命令批次[];
  queueTasks?: 队列任务记录[];
  任务?: 任务系统;
}

export function applyLegacyGameStateOverrides(
  initial: TeyvatGameState,
  overrides: LegacyGameStateOverrides = {},
): TeyvatGameState {
  let next = initial;
  if (overrides.旅人) next = withLegacyTraveler(next, overrides.旅人);
  if (overrides.背包) next = { ...next, 背包: overrides.背包 };
  if (overrides.世界) next = applyLegacyWorldState(next, overrides.世界);
  if (overrides.chatHistory) next = withLegacyChat(next, overrides.chatHistory);
  if (overrides.记忆) next = withLegacyMemory(next, overrides.记忆);
  if (overrides.NPC) next = applyLegacyNpcRecords(next, overrides.NPC);
  if (overrides.手机) next = { ...next, 手机: normalizeCourierSystem(overrides.手机) };
  if (overrides.相册) next = withLegacyAlbum(next, overrides.相册);
  if (overrides.剧情) next = { ...next, 叙事: { ...next.叙事, plotNodes: fromLegacyPlot(overrides.剧情) } };
  if (overrides.剧情编织) next = { ...next, 叙事: { ...next.叙事, storyWeaving: fromLegacyStoryWeaving(overrides.剧情编织) } };
  if (overrides.variableBatches) next = { ...next, 叙事: { ...next.叙事, variableBatches: fromLegacyVariableBatches(overrides.variableBatches) } };
  if (overrides.queueTasks) next = withLegacyQueue(next, overrides.queueTasks);
  if (overrides.任务) next = withLegacyQuest(next, overrides.任务);
  if (overrides.turnCount !== undefined) next = { ...next, turnCount: Math.max(0, Math.trunc(overrides.turnCount)) };
  return normalizeTeyvatGameState(next);
}

export interface UseGameStateReturn {
  game: TeyvatGameState;
  replaceGameState: (next: TeyvatGameState) => void;
  updateGameState: (updater: (current: TeyvatGameState) => TeyvatGameState) => void;
  getGameSessionId: () => number;
  invalidateGameSession: () => void;
  buildTeyvatSavePayload: () => TeyvatSaveData;
  view: ViewState;
  setView: React.Dispatch<React.SetStateAction<ViewState>>;
  旅人: 角色数据结构;
  set旅人: React.Dispatch<React.SetStateAction<角色数据结构>>;
  背包: TeyvatInventory;
  set背包: React.Dispatch<React.SetStateAction<TeyvatInventory>>;
  世界: 世界状态;
  set世界: React.Dispatch<React.SetStateAction<世界状态>>;
  chatHistory: 聊天消息[];
  setChatHistory: React.Dispatch<React.SetStateAction<聊天消息[]>>;
  记忆: 记忆系统;
  set记忆: React.Dispatch<React.SetStateAction<记忆系统>>;
  手机: CourierSystem;
  set手机: React.Dispatch<React.SetStateAction<CourierSystem>>;
  世界树: IrminsulMemory;
  set世界树: React.Dispatch<React.SetStateAction<IrminsulMemory>>;
  蒸汽鸟报: SteambirdNews;
  set蒸汽鸟报: React.Dispatch<React.SetStateAction<SteambirdNews>>;
  图鉴: ArchiveCodex;
  set图鉴: React.Dispatch<React.SetStateAction<ArchiveCodex>>;
  NPC: NPC记录[];
  setNPC: React.Dispatch<React.SetStateAction<NPC记录[]>>;
  相册: 相册系统;
  set相册: React.Dispatch<React.SetStateAction<相册系统>>;
  剧情: 剧情节点[];
  set剧情: React.Dispatch<React.SetStateAction<剧情节点[]>>;
  剧情编织: 剧情编织系统;
  set剧情编织: React.Dispatch<React.SetStateAction<剧情编织系统>>;
  variableBatches: 变量命令批次[];
  setVariableBatches: React.Dispatch<React.SetStateAction<变量命令批次[]>>;
  queueTasks: 队列任务记录[];
  setQueueTasks: React.Dispatch<React.SetStateAction<队列任务记录[]>>;
  任务: 任务系统;
  set任务: React.Dispatch<React.SetStateAction<任务系统>>;
  apiSettings: API设置;
  setApiSettings: React.Dispatch<React.SetStateAction<API设置>>;
  gameSettings: 游戏设置;
  setGameSettings: React.Dispatch<React.SetStateAction<游戏设置>>;
  currentTheme: 主题预设;
  setCurrentTheme: React.Dispatch<React.SetStateAction<主题预设>>;
  worldbooks: 世界书[];
  setWorldbooks: React.Dispatch<React.SetStateAction<世界书[]>>;
  hasSave: boolean;
  setHasSave: React.Dispatch<React.SetStateAction<boolean>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  workflowHint: string;
  setWorkflowHint: React.Dispatch<React.SetStateAction<string>>;
  workflowStatus: 'searching' | 'done' | '';
  setWorkflowStatus: React.Dispatch<React.SetStateAction<'searching' | 'done' | ''>>;
  liveRecallSummary: string;
  setLiveRecallSummary: React.Dispatch<React.SetStateAction<string>>;
  liveRecallFullContent: string;
  setLiveRecallFullContent: React.Dispatch<React.SetStateAction<string>>;
  /** 变量模型校准正在跑（正文已落地，变量在结算中）。期间禁止发下一轮。 */
  pendingVariable: boolean;
  setPendingVariable: React.Dispatch<React.SetStateAction<boolean>>;
  turnCount: number;
  setTurnCount: React.Dispatch<React.SetStateAction<number>>;
  pendingOpeningTrigger: string | null;
  setPendingOpeningTrigger: React.Dispatch<React.SetStateAction<string | null>>;
  interruptedWorkflow: WorkflowRecoveryJournal | null;
  setInterruptedWorkflow: React.Dispatch<React.SetStateAction<WorkflowRecoveryJournal | null>>;
  abortControllerRef: React.RefObject<AbortController | null>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export interface LegacyGameView {
  旅人: 角色数据结构;
  世界: 世界状态;
  chatHistory: 聊天消息[];
  记忆: 记忆系统;
  NPC: NPC记录[];
  相册: 相册系统;
  剧情: 剧情节点[];
  剧情编织: 剧情编织系统;
  variableBatches: 变量命令批次[];
  queueTasks: 队列任务记录[];
  任务: 任务系统;
}

/**
 * Cache legacy projections per canonical slice. Phone/unread/queue updates are
 * frequent; rebuilding chat checkpoints, album metadata and every NPC for an
 * unrelated slice made those tiny updates block the UI.
 */
export function createLegacyGameViewSelector(): (game: TeyvatGameState) => LegacyGameView {
  let previousGame: TeyvatGameState | undefined;
  let previousView: LegacyGameView | undefined;
  return (game) => {
    if (game === previousGame && previousView) return previousView;
    const next: LegacyGameView = {
      旅人: previousGame?.旅行者 === game.旅行者 && previousView ? previousView.旅人 : toLegacyTraveler(game),
      世界: previousGame?.世界 === game.世界 && previousView ? previousView.世界 : toLegacyWorld(game),
      chatHistory: previousGame?.对话 === game.对话 && previousView ? previousView.chatHistory : toLegacyChat(game),
      记忆: previousGame?.记忆 === game.记忆 && previousView ? previousView.记忆 : toLegacyMemory(game),
      NPC: previousGame?.NPC === game.NPC && previousView ? previousView.NPC : mapTeyvatNpcsToLegacy(game),
      相册: previousGame?.相册 === game.相册 && previousView ? previousView.相册 : toLegacyAlbum(game),
      剧情: previousGame?.叙事.plotNodes === game.叙事.plotNodes && previousView ? previousView.剧情 : toLegacyPlot(game.叙事.plotNodes),
      剧情编织: previousGame?.叙事.storyWeaving === game.叙事.storyWeaving && previousView ? previousView.剧情编织 : toLegacyStoryWeaving(game.叙事.storyWeaving),
      variableBatches: previousGame?.叙事.variableBatches === game.叙事.variableBatches && previousView ? previousView.variableBatches : toLegacyVariableBatches(game.叙事.variableBatches),
      queueTasks: previousGame?.后台队列 === game.后台队列 && previousView ? previousView.queueTasks : toLegacyQueue(game),
      任务: previousGame?.任务 === game.任务 && previousView ? previousView.任务 : toLegacyQuest(game),
    };
    previousGame = game;
    if (previousView && Object.keys(next).every((key) => next[key as keyof LegacyGameView] === previousView?.[key as keyof LegacyGameView])) {
      return previousView;
    }
    previousView = next;
    return next;
  };
}

/**
 * `setChatHistory` 的纯函数实现（可单测）。
 *
 * 身份快速通道：updater 原样返回**同一个数组引用**时（无操作更新、幂等 map/filter、
 * React StrictMode 的重复调用），整条 `toLegacyChat` → `withLegacyChat` 重建都可以跳过，
 * 直接返回 `current`；`updateTeyvatState` 见到同一个引用也会让 React 跳过这次渲染。
 *
 * 其余情况与原实现逐字一致：`withLegacyChat(toLegacyChat(current) ± action)`。
 *
 * 关于"更深的切片级 bail-out"：真正省时间的是**逐条 entry 复用**
 * （改一条书签/附图时只重建那一条），但 `withLegacyChat` 末尾的
 * `normalizeConversationLog`（`models/teyvat/runtimeSlices.ts:427-453`）对每条 entry
 * 无条件新建对象并重跑 13 个 normalizer，逐条复用必须改那个文件——超出本次允许改动
 * 的文件范围，故未做（见报告）。
 */
export function applyChatHistoryAction(
  current: TeyvatGameState,
  action: React.SetStateAction<聊天消息[]>,
): TeyvatGameState {
  const legacyChat = toLegacyChat(current);
  const nextChat = applyStateAction(legacyChat, action);
  if (nextChat === legacyChat) return current;
  return withLegacyChat(current, nextChat);
}

/**
 * 同步读取**活体**根状态。
 *
 * 为什么需要它：`UseGameStateReturn` 是**每次渲染一份的快照** ——
 * 长耗时流程（变量结算可能数十秒）里 `state.game` 一直是最初那次渲染的根，
 * 主流程自己在本回合写入的内容（例如 `prepareSendTurn` 追加的 user 消息）都还不在里面。
 * 用这份旧根做存档身份 CAS / 三路合并的基准，会得到必然错误的结论：
 *
 * - 拿它当 CAS 基准 → 与提交那一刻的活体根必然不等（对话少 1 条）→ 每一次结算都被误判成
 *   「等待期间换了存档」而整体丢弃（症状：`turnCount` 不再增长，聊天徽标与自动存档的回合数卡住，
 *   手机里所有新消息都落在同一回合、回合分割线因此全部消失）；
 * - 拿它当合并基准 → 把主流程自己的写入误判成「玩家并发修改」。
 *
 * 实现与代价（对抗审查 2026-09-20 已实测更正）：
 * `flushSync` + **同引用返回**的 updater —— `updateTeyvatState` 直接返回 `current`，
 * 所以这次更新**不改变状态**（这一点由 `tests/unit/liveGameStateRead.test.ts` 用真 React 断言）。
 * 但**不能**据此说「React 跳过渲染」：`flushSync` 会绕过 React 的同引用 bailout，
 * 每次探测真的会渲染一次（同一 harness 实测：普通同引用更新 2→2 次渲染；
 * 包进 flushSync 的同一次更新 2→3 次；裸 `flushSync(() => {})` 2→2）。
 * 一次正常结算用 2 次探测、恢复起点 1 次 —— 这是「同步读到活体根」的代价，属可接受成本。
 * （同一模式已用于 `commitPostSettlementBackgroundState` 的 CAS 读取。）
 */
export function readLiveGameState(state: UseGameStateReturn): TeyvatGameState {
  let live: TeyvatGameState | null = null;
  flushSync(() => {
    state.updateGameState((current) => {
      live = current;
      return current;
    });
  });
  return live ?? state.game;
}

export function useGameState(): UseGameStateReturn {
  const [view, setView] = useState<ViewState>('home');
  const { game, replaceGameState, updateGameState, getGameSessionId, invalidateGameSession, buildTeyvatSavePayload } = useTeyvatRuntime();
  // Legacy 适配层转换必须按 game 引用缓存：否则任何一次 setState（哪怕只是 loading）
  // 都会在渲染期重建这些对象，导致传给子组件的 props 引用全变、React.memo 全部失效。
  const selectLegacyGameView = useMemo(createLegacyGameViewSelector, []);
  const legacyView = selectLegacyGameView(game);
  const { 旅人, 世界, chatHistory, 记忆, NPC, 相册, 剧情, 剧情编织, variableBatches, queueTasks, 任务 } = legacyView;
  // 直接切片是 game 内部引用，随 game 更新天然保持稳定，无需 memo。
  const 背包 = game.背包;
  const 手机 = game.手机;
  const 世界树 = game.世界树;
  const 蒸汽鸟报 = game.蒸汽鸟报;
  const 图鉴 = game.图鉴;

  const set旅人 = useCallback<React.Dispatch<React.SetStateAction<角色数据结构>>>((action) => {
    updateGameState((current) => withLegacyTraveler(current, applyStateAction(toLegacyTraveler(current), action)));
  }, [updateGameState]);
  const set背包 = useCallback<React.Dispatch<React.SetStateAction<TeyvatInventory>>>((action) => {
    updateGameState((current) => ({ ...current, 背包: applyStateAction(current.背包, action) }));
  }, [updateGameState]);
  const set世界 = useCallback<React.Dispatch<React.SetStateAction<世界状态>>>((action) => {
    updateGameState((current) => applyLegacyWorldState(current, applyStateAction(toLegacyWorld(current), action)));
  }, [updateGameState]);
  const setChatHistory = useCallback<React.Dispatch<React.SetStateAction<聊天消息[]>>>((action) => {
    updateGameState((current) => applyChatHistoryAction(current, action));
  }, [updateGameState]);
  const set记忆 = useCallback<React.Dispatch<React.SetStateAction<记忆系统>>>((action) => {
    updateGameState((current) => withLegacyMemory(current, applyStateAction(toLegacyMemory(current), action)));
  }, [updateGameState]);
  const set手机 = useCallback<React.Dispatch<React.SetStateAction<CourierSystem>>>((action) => {
    updateGameState((current) => ({ ...current, 手机: applyStateAction(current.手机, action) }));
  }, [updateGameState]);
  const set世界树 = useCallback<React.Dispatch<React.SetStateAction<IrminsulMemory>>>((action) => {
    updateGameState((current) => ({ ...current, 世界树: applyStateAction(current.世界树, action) }));
  }, [updateGameState]);
  const set蒸汽鸟报 = useCallback<React.Dispatch<React.SetStateAction<SteambirdNews>>>((action) => {
    updateGameState((current) => ({ ...current, 蒸汽鸟报: applyStateAction(current.蒸汽鸟报, action) }));
  }, [updateGameState]);
  const set图鉴 = useCallback<React.Dispatch<React.SetStateAction<ArchiveCodex>>>((action) => {
    updateGameState((current) => ({ ...current, 图鉴: applyStateAction(current.图鉴, action) }));
  }, [updateGameState]);
  const setNPC = useCallback<React.Dispatch<React.SetStateAction<NPC记录[]>>>((action) => {
    updateGameState((current) => applyLegacyNpcRecords(current, applyStateAction(mapTeyvatNpcsToLegacy(current), action)));
  }, [updateGameState]);
  const set相册 = useCallback<React.Dispatch<React.SetStateAction<相册系统>>>((action) => {
    updateGameState((current) => withLegacyAlbum(current, applyStateAction(toLegacyAlbum(current), action)));
  }, [updateGameState]);
  const set剧情 = useCallback<React.Dispatch<React.SetStateAction<剧情节点[]>>>((action) => {
    updateGameState((current) => ({ ...current, 叙事: { ...current.叙事, plotNodes: fromLegacyPlot(applyStateAction(toLegacyPlot(current.叙事.plotNodes), action)) } }));
  }, [updateGameState]);
  const set剧情编织 = useCallback<React.Dispatch<React.SetStateAction<剧情编织系统>>>((action) => {
    updateGameState((current) => {
      const previous = toLegacyStoryWeaving(current.叙事.storyWeaving);
      return { ...current, 叙事: { ...current.叙事, storyWeaving: fromLegacyStoryWeaving(applyStateAction(previous, action)) } };
    });
  }, [updateGameState]);
  const setVariableBatches = useCallback<React.Dispatch<React.SetStateAction<变量命令批次[]>>>((action) => {
    updateGameState((current) => ({ ...current, 叙事: { ...current.叙事, variableBatches: fromLegacyVariableBatches(applyStateAction(toLegacyVariableBatches(current.叙事.variableBatches), action)) } }));
  }, [updateGameState]);
  const setQueueTasks = useCallback<React.Dispatch<React.SetStateAction<队列任务记录[]>>>((action) => {
    updateGameState((current) => withLegacyQueue(current, applyStateAction(toLegacyQueue(current), action)));
  }, [updateGameState]);
  const set任务 = useCallback<React.Dispatch<React.SetStateAction<任务系统>>>((action) => {
    updateGameState((current) => withLegacyQuest(current, applyStateAction(toLegacyQuest(current), action)));
  }, [updateGameState]);
  const [apiSettings, setApiSettings] = useState<API设置>(创建空API设置);
  const [gameSettings, setGameSettingsState] = useState<游戏设置>(创建默认游戏设置);
  const setGameSettings = useCallback<React.Dispatch<React.SetStateAction<游戏设置>>>((action) => {
    setGameSettingsState((current) => normalizeRetiredTavernSelection(applyStateAction(current, action)));
  }, []);
  const [currentTheme, setCurrentTheme] = useState<主题预设>('mondstadt');
  const [worldbooks, setWorldbooks] = useState<世界书[]>([]);
  const [hasSave, setHasSave] = useState(false);
  const [loading, setLoading] = useState(false);
  const [workflowHint, setWorkflowHint] = useState('');
  const [workflowStatus, setWorkflowStatus] = useState<'searching' | 'done' | ''>('');
  const [liveRecallSummary, setLiveRecallSummary] = useState('');
  const [liveRecallFullContent, setLiveRecallFullContent] = useState('');
  const [pendingVariable, setPendingVariable] = useState(false);
  const turnCount = game.turnCount;
  const setTurnCount = useCallback<React.Dispatch<React.SetStateAction<number>>>((action) => {
    updateGameState((current) => ({ ...current, turnCount: Math.max(0, Math.trunc(applyStateAction(current.turnCount, action))) }));
  }, [updateGameState]);
  const [pendingOpeningTrigger, setPendingOpeningTrigger] = useState<string | null>(null);
  const [interruptedWorkflow, setInterruptedWorkflow] = useState<WorkflowRecoveryJournal | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Load persisted settings on mount
  useEffect(() => {
    (async () => {
      const recoveryJournal = await loadWorkflowRecoveryJournal();
      if (recoveryJournal) {
        setInterruptedWorkflow(recoveryJournal);
        setWorkflowHint('上次生成被浏览器中断，输入将在进入游戏后恢复；请检查存档后重新发送。');
      }

      const savedTheme = await loadSetting<主题预设>('theme');
      if (savedTheme) setCurrentTheme(normalizeThemeId(savedTheme) as 主题预设);

      const savedApi = await loadSetting<API设置>('apiSettings');
      if (savedApi) setApiSettings(savedApi);

      const savedGameRecord = await loadSetting<Record<string, unknown>>('gameSettings');
      if (savedGameRecord) {
        // 兼容旧存档：variableApi 是新字段，缺失时用默认覆盖
        const defaults = 创建默认游戏设置();
        const legacyRoutes = readLegacyGameSettingRoutes(savedGameRecord);
        const legacySteambirdSettings = legacyRoutes.steambird;
        const legacyCodexSettings = legacyRoutes.codex;
        const formalSavedRecord = legacyRoutes.formal;
        const savedGame = formalSavedRecord as Partial<游戏设置>;
        const merged: 游戏设置 = {
          ...defaults,
          ...savedGame,
          蒸汽鸟报系统: 归一化蒸汽鸟报系统设置((savedGame.蒸汽鸟报系统 ?? legacySteambirdSettings) as Partial<游戏设置['蒸汽鸟报系统']>),
          手机系统: 归一化手机系统设置(savedGame.手机系统),
          图鉴系统: 归一化图鉴系统设置((savedGame.图鉴系统 ?? legacyCodexSettings) as Partial<游戏设置['图鉴系统']>),
          剧情编织系统: 归一化剧情编织系统设置(savedGame.剧情编织系统),
          文生图系统: 归一化文生图系统设置(savedGame.文生图系统),
          记忆系统: 归一化记忆系统设置(savedGame.记忆系统),
          额外功能: 归一化额外功能设置(savedGame.额外功能),
          variableApi: savedGame.variableApi ?? defaults.variableApi,
          enableClaudeMode: savedGame.enableClaudeMode ?? defaults.enableClaudeMode,
          deepSeekMainMode: savedGame.deepSeekMainMode ?? defaults.deepSeekMainMode,
          backgroundTaskMode: savedGame.backgroundTaskMode ?? defaults.backgroundTaskMode,
          enableCacheDiagnostics: savedGame.enableCacheDiagnostics ?? defaults.enableCacheDiagnostics,
          enableMaleNsfwArchive: savedGame.enableMaleNsfwArchive ?? defaults.enableMaleNsfwArchive,
          enablePlayerSpeechExpansion: savedGame.enableNoControl === true ? false : savedGame.enablePlayerSpeechExpansion === true,
          visualTextSettings: 归一化视觉文本设置(savedGame.visualTextSettings),
          promptModules: migratePromptModules({ ...defaults, ...savedGame }),
          // 方案 A 三层 order 区间迁移：预设库里的 ST 模块也要 +50 偏移
          // 与 saveLoadWorkflow.ts 手动加载路径保持一致，避免两条加载路径迁移逻辑不一致
          stPresets: migrateStPresetOrders(savedGame.stPresets),
          promptModuleOrderVersion: 1,
        };
        // 迁移后清空 legacy customPrompt，避免下次启动重复追加
        if (savedGame.customPrompt && merged.promptModules.some((m) => m.id === 'legacy_custom')) {
          merged.customPrompt = '';
        }
        // D1（第二轮审计）：`migrateSTPresetsV1ToV2` 此前**只被回归脚本调用、生产里 0 调用**，
        // 于是老玩家的 V1 预设永远进不了 V2 列表（V2 在 PromptModulesTab 与 systemPromptBuilder 里都是活的）。
        // 这里在启动加载时接线；迁移是纯函数且已有约 30 条行为断言（scripts/st-preset-migration-regression.mjs）。
        const stPresetMigration = migrateSTPresetsV1ToV2(merged);
        setGameSettings(stPresetMigration.settings);
      }

      try {
        const bundledStoryWeaving = await loadAllBundledStoryWeavingPresets();
        const savedStoryWeaving = await loadSetting<剧情编织系统>('storyWeavingSystem');
        const mergedStoryWeaving = hydratePersistedStoryWeavingSystem(savedStoryWeaving, bundledStoryWeaving);
        set剧情编织(mergedStoryWeaving);
        await saveSetting('storyWeavingSystem', buildPersistedStoryWeavingSystem(mergedStoryWeaving));
      } catch (err) {
        console.warn('[story-weaving] preset 加载失败，回退到本地已存剧情编织:', err);
        const savedStoryWeaving = await loadSetting<剧情编织系统>('storyWeavingSystem');
        if (isSelfContainedStoryWeavingSystem(savedStoryWeaving)) {
          set剧情编织(归一化剧情编织系统(savedStoryWeaving));
        } else if (savedStoryWeaving) {
          console.warn('[story-weaving] 本地状态是轻量缓存，缺少原著正文；等待下次启动重新加载内置资源。');
        }
      }

      try {
        const preset = await loadAllBundledCodexPresets();
        const savedCodex = await loadSetting<旧图鉴系统>(LEGACY_CODEX_SETTING_KEY);
        const savedMigrationAt = await loadSetting<number>(CODEX_CHARACTER_REBUILD_MIGRATION_KEY);
        const migrationAt = savedMigrationAt ?? Date.now();
        if (!savedMigrationAt) {
          await saveSetting(CODEX_CHARACTER_REBUILD_MIGRATION_KEY, migrationAt);
        }
        const mergedCodex = mergeBundledCodexSystem(preset, savedCodex, migrationAt);
        updateGameState((current) => applyLegacyCodex(current, mergedCodex));
      } catch (err) {
        console.warn('[codex] preset 加载失败，回退到本地图鉴:', err);
        const savedCodex = await loadSetting<旧图鉴系统>(LEGACY_CODEX_SETTING_KEY);
        if (savedCodex) {
          const savedMigrationAt = await loadSetting<number>(CODEX_CHARACTER_REBUILD_MIGRATION_KEY);
          const migrationAt = savedMigrationAt ?? Date.now();
          if (!savedMigrationAt) {
            await saveSetting(CODEX_CHARACTER_REBUILD_MIGRATION_KEY, migrationAt);
          }
          updateGameState((current) => applyLegacyCodex(current, 升级自制图鉴系统({
            条目: removeLegacyCodexCharacterEntries(
              removeRetiredCodexEntries(savedCodex.条目.filter((entry) => !isBundledCodexDuplicate(entry))),
              migrationAt,
            ),
          })));
        }
      }

      // Worldbooks 加载策略:
      // - savedWorldbooks === null   → 首次启动,把预设写入 IndexedDB(玩家之后可自由修改/删除)
      // - savedWorldbooks 是数组     → 玩家已与世界书交互过,完全尊重其状态,不再覆盖
      const builtins = createBuiltinWorldbooks();
      const rawSavedWorldbooks = await loadSetting<世界书[]>(WORLDBOOK_STORAGE_KEY);
      // 旧版本只有 'builtin_core_config' 一本内置；现在已拆为 6 本，老用户库里这本要丢弃。
      // 同样：CoT 已从世界书迁移到提示词模块系统，旧的 'builtin_cot' 本也要丢弃。
      // 它里面的 'builtin_first_turn_rule' 条目已经被新的 'builtin_opening_rule' 本继承。
      // normalize 把 turnGuard='first_only' 迁移成 scope=['opening']。
      const savedWorldbooks = rawSavedWorldbooks
        ? normalizeWorldbooks(
            rawSavedWorldbooks.filter(
              (b) =>
                b.id !== 'builtin_core_config' &&
                b.id !== 'builtin_cot' &&
                !REMOVED_LEGACY_WORLDBOOK_IDS.has(b.id),
            ),
          )
        : rawSavedWorldbooks;

      if (savedWorldbooks === null) {
        try {
          const presets = await loadAllBundledWorldbookPresets();
          const initial = [...builtins, ...presets];
          setWorldbooks(initial);
          await saveSetting(WORLDBOOK_STORAGE_KEY, initial);
        } catch (err) {
          console.warn('[opening-worldbook] preset 加载失败,使用内置空集:', err);
          setWorldbooks(builtins);
        }
      } else if (savedWorldbooks.length) {
        const builtinIds = new Set(builtins.map((b) => b.id));
        const userBooks = savedWorldbooks.filter((b) => !builtinIds.has(b.id));
        const merged = builtins.map((builtin) => {
          const saved = savedWorldbooks.find((b) => b.id === builtin.id);
          if (!saved) return builtin;
          // calibration 内置世界书只是独立模型真实 prompt 的只读资料展示。
          // 新闻/手机/变量等服务层直接 import 源码常量，旧存档里的编辑/关闭不会影响真实 API；
          // 因此这里必须回到源码最新版，避免 UI 展示与真实请求再次分叉。
          if (isCalibrationWorldbook(builtin)) return builtin;
          const savedEntries = saved.entries || [];
          const entries = builtin.entries.map((entry) => {
            const savedEntry = savedEntries.find((item) => item.id === entry.id);
            if (!savedEntry) return entry;
            // D12(2026-07-26): 源码条目声明了更高 contentVersion 时强制刷新内容,只保留用户开关。
            // 修复"内置世界书条目内容对老用户永不更新"的漂移缺陷。
            if ((entry.contentVersion ?? 0) > (savedEntry.contentVersion ?? 0)) {
              return { ...entry, enabled: savedEntry.enabled };
            }
            return { ...savedEntry, title: entry.title };
          });
          return { ...builtin, enabled: saved.enabled, entries, updatedAt: saved.updatedAt };
        });
        const nextWorldbooks = [...merged, ...userBooks];
        setWorldbooks(nextWorldbooks);
        await saveSetting(WORLDBOOK_STORAGE_KEY, nextWorldbooks);
      } else {
        setWorldbooks(builtins);
        await saveSetting(WORLDBOOK_STORAGE_KEY, builtins);
      }

      const saveExists = await hasAnySave();
      setHasSave(saveExists);
    })();
  }, []);

  // Apply theme on change
  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  useEffect(() => {
    setGameSettings((prev) =>
      prev.记忆系统
        ? {
            ...prev,
            蒸汽鸟报系统: 归一化蒸汽鸟报系统设置(prev.蒸汽鸟报系统),
            手机系统: 归一化手机系统设置(prev.手机系统),
            图鉴系统: 归一化图鉴系统设置(prev.图鉴系统),
            剧情编织系统: 归一化剧情编织系统设置(prev.剧情编织系统),
            文生图系统: 归一化文生图系统设置(prev.文生图系统),
            记忆系统: 归一化记忆系统设置(prev.记忆系统),
            enableClaudeMode: prev.enableClaudeMode ?? 创建默认游戏设置().enableClaudeMode,
            deepSeekMainMode: prev.deepSeekMainMode ?? 创建默认游戏设置().deepSeekMainMode,
            backgroundTaskMode: prev.backgroundTaskMode ?? 创建默认游戏设置().backgroundTaskMode,
            visualTextSettings: 归一化视觉文本设置(prev.visualTextSettings),
          }
        : {
            ...prev,
            蒸汽鸟报系统: 创建默认蒸汽鸟报系统设置(),
            手机系统: 创建默认手机系统设置(),
            图鉴系统: 创建默认图鉴系统设置(),
            剧情编织系统: 创建默认剧情编织系统设置(),
            文生图系统: 创建默认文生图系统设置(),
            记忆系统: 创建默认记忆系统设置(),
            enableClaudeMode: 创建默认游戏设置().enableClaudeMode,
            deepSeekMainMode: 创建默认游戏设置().deepSeekMainMode,
            backgroundTaskMode: 创建默认游戏设置().backgroundTaskMode,
            visualTextSettings: 归一化视觉文本设置(prev.visualTextSettings),
          },
    );
  }, []);

  return {
    game, replaceGameState, updateGameState, getGameSessionId, invalidateGameSession, buildTeyvatSavePayload,
    view, setView,
    旅人, set旅人,
    背包, set背包,
    世界, set世界,
    chatHistory, setChatHistory,
    记忆, set记忆,
    手机, set手机,
    世界树, set世界树,
    蒸汽鸟报, set蒸汽鸟报,
    图鉴, set图鉴,
    NPC, setNPC,
    相册, set相册,
    剧情, set剧情,
    剧情编织, set剧情编织,
    variableBatches, setVariableBatches,
    queueTasks, setQueueTasks,
    任务, set任务,
    apiSettings, setApiSettings,
    gameSettings, setGameSettings,
    currentTheme, setCurrentTheme,
    worldbooks, setWorldbooks,
    hasSave, setHasSave,
    loading, setLoading,
    workflowHint, setWorkflowHint,
    workflowStatus, setWorkflowStatus,
    liveRecallSummary, setLiveRecallSummary,
    liveRecallFullContent, setLiveRecallFullContent,
    pendingVariable, setPendingVariable,
    turnCount, setTurnCount,
    pendingOpeningTrigger, setPendingOpeningTrigger,
    interruptedWorkflow, setInterruptedWorkflow,
    abortControllerRef, scrollRef,
  };
}

// ── W16 续玩提示：从完整存档或存档摘要构建首页续玩卡数据 ──
export interface 续玩预览 {
  turnCount: number;
  currentLocation: string;
  currentArc: string;
  recentTurns: string[];
}

export function buildResumePreview(save: 存档数据 | SaveListItemSummary): 续玩预览 {
  const full = save as 存档数据;
  const summary = save as SaveListItemSummary;
  const chatHistory = Array.isArray(full.chatHistory) ? full.chatHistory : [];
  const recentTurns = chatHistory.length
    ? chatHistory
        .filter((m) => m.role === 'assistant' && (m.content || m.parsedResponse?.body))
        .slice(-3)
        .map((m) => String(m.parsedResponse?.body || m.content).trim().slice(0, 120))
    : [String(summary.lastSummary || '').trim().slice(0, 120)].filter(Boolean);
  return {
    turnCount: save.turnCount ?? (chatHistory.length ? chatHistory.length + 1 : 1),
    currentLocation: full.世界?.当前地点?.trim() || summary.currentLocation || '',
    currentArc: full.世界?.开局档案?.章节锚点名称?.trim() || summary.worldPeriodName || '',
    recentTurns,
  };
}
