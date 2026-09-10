import type { 手机系统 as 旧信使系统 } from './models/courier';
import type { 新闻条目 as 旧报刊条目 } from './models/steambird';
import type { 忆庭系统 as 旧世界树系统 } from './models/irminsul';
import type { 图鉴系统 } from '@/models/codexArchive';

export type { 旧信使系统, 旧报刊条目, 旧世界树系统 };
export type 旧图鉴系统 = 图鉴系统;

const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

export function readLegacyRuntimeSlices(record: Record<string, unknown>): {
  hasIrminsul: boolean;
  irminsul?: 旧世界树系统;
  hasCodex: boolean;
  codex?: 图鉴系统;
  hasCourier: boolean;
  courier?: 旧信使系统;
  hasSteambird: boolean;
  steambird?: 旧报刊条目[];
} {
  return {
    hasIrminsul: hasOwn(record, '忆庭'),
    irminsul: record.忆庭 as 旧世界树系统 | undefined,
    hasCodex: hasOwn(record, '智库'),
    codex: record.智库 as 图鉴系统 | undefined,
    hasCourier: hasOwn(record, '手机'),
    courier: record.手机 as 旧信使系统 | undefined,
    hasSteambird: hasOwn(record, '新闻'),
    steambird: record.新闻 as 旧报刊条目[] | undefined,
  };
}

export function readLegacyApiRoutes(record: Record<string, unknown>): {
  steambird?: unknown;
  courier?: unknown;
  codex?: unknown;
  irminsulRecall?: unknown;
  irminsulArchive?: unknown;
} {
  return {
    steambird: record.新闻系统,
    courier: record.手机系统,
    codex: record.智库系统,
    irminsulRecall: record.忆庭召回API,
    irminsulArchive: record.忆庭精炼API,
  };
}

export function omitLegacyApiRoutes(record: Record<string, unknown>): Record<string, unknown> {
  const result = { ...record };
  delete result.新闻系统;
  delete result.手机系统;
  delete result.智库系统;
  delete result.忆庭召回API;
  delete result.忆庭精炼API;
  return result;
}

export function readLegacyGameSettingRoutes(record: Record<string, unknown>): {
  steambird?: unknown;
  courier?: unknown;
  codex?: unknown;
  formal: Record<string, unknown>;
} {
  const formal = { ...record };
  const steambird = formal.新闻系统;
  const courier = formal.手机系统;
  const codex = formal.智库系统;
  delete formal.新闻系统;
  delete formal.手机系统;
  delete formal.智库系统;
  return { steambird, courier, codex, formal };
}

export const LEGACY_CODEX_SETTING_KEY = 'zhikuSystem';

export type LegacySaveRootFields = {
  忆庭?: 旧世界树系统;
  智库?: 图鉴系统;
  手机?: 旧信使系统;
  新闻?: 旧报刊条目[];
};

export type WithoutLegacyRuntimeSlices<T> = Omit<T, keyof LegacySaveRootFields>;

export type LegacyMemorySettingsInput = {
  忆庭启用?: boolean;
  忆庭召回最早触发回合?: number;
  忆庭召回API?: unknown;
  忆庭精炼API?: unknown;
  忆庭召回条数?: number;
  忆庭召回提示词?: string;
  忆庭精炼提示词?: string;
  忆庭独立精炼?: boolean;
};

export function omitLegacyMemorySettings(record: Record<string, unknown>): Record<string, unknown> {
  const result = { ...record };
  delete result.忆庭启用;
  delete result.忆庭召回最早触发回合;
  delete result.忆庭召回API;
  delete result.忆庭精炼API;
  delete result.忆庭召回条数;
  delete result.忆庭召回提示词;
  delete result.忆庭精炼提示词;
  delete result.忆庭独立精炼;
  return result;
}

export interface LegacyIrminsulMemorySettings {
  enabled?: boolean;
  recallThreshold?: number;
  recallApi?: unknown;
  archiveApi?: unknown;
  recallLimit?: number;
  recallPrompt?: string;
  archivePrompt?: string;
  independentArchive?: boolean;
}

export function readLegacyIrminsulMemorySettings(
  input: LegacyMemorySettingsInput | undefined,
): LegacyIrminsulMemorySettings {
  if (!input) return {};
  return {
    enabled: input.忆庭启用,
    recallThreshold: input.忆庭召回最早触发回合,
    recallApi: input.忆庭召回API,
    archiveApi: input.忆庭精炼API,
    recallLimit: input.忆庭召回条数,
    recallPrompt: input.忆庭召回提示词,
    archivePrompt: input.忆庭精炼提示词,
    independentArchive: input.忆庭独立精炼,
  };
}

export function readLegacyCodexElementTag(tagMap: ReadonlyMap<string, string[]>): string | undefined {
  return tagMap.get('命途')?.find(Boolean);
}

export function readLegacyCodexDebugMetadata(record: Record<string, unknown>): {
  preview?: unknown;
  injection?: unknown;
  rawText?: unknown;
  usedModel?: unknown;
} {
  return {
    preview: record.zhikuRecallPreview,
    injection: record.zhikuRecallInjection,
    rawText: record.zhikuRecallRawText,
    usedModel: record.zhikuRecallUsedModel,
  };
}

export function getLegacyElementalEchoTagAliases(): {
  invite: string[];
  questions: string[];
  judgement: string[];
} {
  return {
    invite: ['命途狭间触发'],
    questions: ['命途狭间问答'],
    judgement: ['命途狭间评判'],
  };
}

export function isLegacyTravelerCommandPath(path: string): boolean {
  return /(?:^|\.)(?:命途列表|手机|新闻|智库|忆庭)(?:\.|$)|^背包(?:\.|$)/u.test(path);
}

export function normalizeLegacyDesktopAppInfo<T extends { appDataDir: string; codexDir?: string }>(raw: T): T & { codexDir: string } {
  const legacy = raw as T & { zhikuDir?: string };
  const { zhikuDir, ...formal } = legacy;
  return {
    ...formal,
    codexDir: raw.codexDir || zhikuDir || `${raw.appDataDir}/zhiku`,
  } as T & { codexDir: string };
}

export function legacyDesktopDirectoryTarget(target: string): string {
  return target === 'codex' ? 'zhiku' : target;
}

export function getLegacyDesktopSettingPath(key: string): string | undefined {
  return key === 'codexSystem' ? 'zhiku/system.json' : undefined;
}

const LEGACY_PACKAGE_SYSTEM_FIELDS = [
  ['记忆', 'systems/memory.json'],
  ['忆庭', 'systems/yiting.json'],
  ['智库', 'systems/zhiku-runtime.json'],
  ['手机', 'systems/phone.json'],
  ['NPC', 'systems/npc.json'],
  ['相册', 'systems/album.json'],
  ['新闻', 'systems/news.json'],
  ['剧情', 'systems/plot.json'],
  ['剧情编织', 'systems/story-weaving.json'],
  ['variableBatches', 'systems/variable-batches.json'],
  ['queueTasks', 'systems/queue-tasks.json'],
  ['任务', 'systems/quests.json'],
] as const;

export function restoreLegacyPackageSystems(
  save: Record<string, unknown>,
  read: (path: string) => unknown,
): Record<string, unknown> {
  const restored = { ...save };
  for (const [field, path] of LEGACY_PACKAGE_SYSTEM_FIELDS) {
    const value = read(path);
    if (value !== undefined) restored[field] = value;
  }
  return restored;
}

export function restoreLegacyDeltaView(
  baseSave: Record<string, unknown>,
  storedSave: Record<string, unknown>,
  delta: {
    chatHistoryMode: 'append' | 'replace';
    chatBaseLength: number;
    chatHistory: unknown[];
    fields: Record<string, unknown>;
  },
): Record<string, unknown> {
  const baseChat = Array.isArray(baseSave.chatHistory) ? baseSave.chatHistory : [];
  const chatHistory = delta.chatHistoryMode === 'append'
    ? [...baseChat.slice(0, delta.chatBaseLength), ...delta.chatHistory]
    : delta.chatHistory;
  return {
    ...baseSave,
    ...delta.fields,
    id: storedSave.id,
    type: storedSave.type,
    timestamp: storedSave.timestamp,
    turnCount: storedSave.turnCount,
    chatHistory,
    saveTree: storedSave.saveTree,
    saveStorage: { mode: 'checkpoint' },
  };
}

const countLegacyArray = (value: unknown): number => Array.isArray(value) ? value.length : 0;

function countLegacyCodexEntries(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const maybe = value as Record<string, unknown>;
  return countLegacyArray(maybe.documents)
    + countLegacyArray(maybe.entries)
    + countLegacyArray(maybe.shards)
    + countLegacyArray(maybe.资料);
}

export function countLegacySaveSystems(save: Record<string, unknown>): {
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
} {
  const memory = save.记忆 as Record<string, unknown> | undefined;
  const irminsul = save.忆庭 as Record<string, unknown> | undefined;
  const courier = save.手机 as Record<string, unknown> | undefined;
  const album = save.相册 as Record<string, unknown> | undefined;
  const quests = save.任务 as Record<string, unknown> | undefined;
  return {
    memories: countLegacyArray(memory?.longTermMemories),
    irminsulEntries: countLegacyArray(irminsul?.回忆档案),
    codexEntries: countLegacyCodexEntries(save.智库),
    courierContacts: countLegacyArray(courier?.contacts),
    npcRecords: countLegacyArray(save.NPC),
    albumAssets: countLegacyArray(album?.assets),
    albumEntries: countLegacyArray(album?.entries),
    steambirdArticles: countLegacyArray(save.新闻),
    plotNodes: countLegacyArray(save.剧情),
    variableBatches: countLegacyArray(save.variableBatches),
    queueTasks: countLegacyArray(save.queueTasks),
    quests: countLegacyArray(quests?.进行中) + countLegacyArray(quests?.已完成) + countLegacyArray(quests?.已放弃),
  };
}

export function normalizeLegacyPromptModuleId(id: string): string {
  if (id === 'builtin_main_plot_cot') return 'builtin_narrative_main';
  if (id === 'builtin_opening_cot') return 'builtin_narrative_opening';
  if (id === 'builtin_preset_opening_cot') return 'builtin_narrative_opening_preset';
  if (id === 'builtin_free_opening_cot') return 'builtin_narrative_opening_free';
  if (id === 'builtin_path_awakening_cot') return 'builtin_narrative_elemental_echo';
  if (id === 'builtin_quest_cot') return 'builtin_quest_narrative_rules';
  if (id === 'builtin_quest_output_format') return 'builtin_quest_fact_format';
  if (id === 'builtin_variable_cot') return 'builtin_domain_command_rules';
  if (id === 'builtin_variable_output_format') return 'builtin_domain_command_output_format';
  if (id === 'builtin_steambird_cot' || id === 'builtin_news_cot') return 'builtin_steambird_editorial_rules';
  if (id === 'builtin_courier_cot' || id === 'builtin_phone_cot') return 'builtin_courier_dialogue_rules';
  if (id === 'builtin_codex_cot' || id === 'builtin_zhiku_cot') return 'builtin_codex_retrieval_rules';
  if (id === 'builtin_story_weaving_worldbook') return 'builtin_canon_worldbook';
  if (id === 'builtin_story_weaving_cot') return 'builtin_canon_decomposition_rules';
  if (id === 'builtin_story_weaving_output_format') return 'builtin_canon_output_format';
  if (id.startsWith('builtin_phone_')) return `builtin_courier_${id.slice('builtin_phone_'.length)}`;
  if (id.startsWith('custom_phone_')) return `custom_courier_${id.slice('custom_phone_'.length)}`;
  if (id.startsWith('st_import_phone_')) return `st_import_courier_${id.slice('st_import_phone_'.length)}`;
  if (id.startsWith('builtin_news_')) return `builtin_steambird_${id.slice('builtin_news_'.length)}`;
  if (id.startsWith('custom_news_')) return `custom_steambird_${id.slice('custom_news_'.length)}`;
  if (id.startsWith('st_import_news_')) return `st_import_steambird_${id.slice('st_import_news_'.length)}`;
  if (id.startsWith('builtin_zhiku_')) return `builtin_codex_${id.slice('builtin_zhiku_'.length)}`;
  if (id.startsWith('custom_zhiku_')) return `custom_codex_${id.slice('custom_zhiku_'.length)}`;
  if (id.startsWith('st_import_zhiku_')) return `st_import_codex_${id.slice('st_import_zhiku_'.length)}`;
  if (id.startsWith('builtin_yiting_')) return `builtin_irminsul_${id.slice('builtin_yiting_'.length)}`;
  if (id.startsWith('custom_yiting_')) return `custom_irminsul_${id.slice('custom_yiting_'.length)}`;
  if (id.startsWith('st_import_yiting_')) return `st_import_irminsul_${id.slice('st_import_yiting_'.length)}`;
  return id;
}

const LEGACY_NPC_NAMES_BY_KEY: Readonly<Record<string, string>> = {
  march7th: '三月七', march7: '三月七', march: '三月七', danheng: '丹恒', dan_heng: '丹恒',
  himeko: '姬子', welt: '瓦尔特', pompom: '帕姆', 'pom-pom': '帕姆', herta: '黑塔',
  asta: '艾丝妲', arlan: '阿兰', stelle: '星', caelus: '穹',
};

const LEGACY_NPC_KEYS_BY_NAME: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(LEGACY_NPC_NAMES_BY_KEY).map(([key, name]) => [name, key]),
);

export const readLegacyNpcNameFromKey = (key: string): string => LEGACY_NPC_NAMES_BY_KEY[key] ?? '';
export const readLegacyNpcKeyFromName = (name: string): string => LEGACY_NPC_KEYS_BY_NAME[name] ?? '';

export function normalizeLegacyFactKind(value: string): 'courier_seed' | undefined {
  return ['手机来信', 'phone_seed', 'phoneSeed', 'phone_message_seed'].includes(value)
    ? 'courier_seed'
    : undefined;
}

export function normalizeLegacyRecoveryPhase(value: string): 'settlement_committed' | undefined {
  return value === 'phone_seed' || value === 'news' ? 'settlement_committed' : undefined;
}

export function hasLegacyDomainPath(path: string): boolean {
  return /(?:^|\.)(?:命途列表|手机|新闻|智库|忆庭)(?:\.|$)|^背包(?:\.|$)/.test(path);
}

export function readLegacyCodexRecallFields(value: Record<string, unknown>): {
  preview?: unknown;
  injection?: unknown;
  rawText?: unknown;
  usedModel?: unknown;
} {
  return {
    preview: value.zhikuRecallPreview,
    injection: value.zhikuRecallInjection,
    rawText: value.zhikuRecallRawText,
    usedModel: value.zhikuRecallUsedModel,
  };
}

export function readLegacyCodexGovernanceCategory(value: unknown): 'archon' | 'element' | undefined {
  if (value === 'aeon') return 'archon';
  if (value === 'path') return 'element';
  return undefined;
}

export function readLegacyCodexChannelFlag(
  entry: Record<string, unknown>,
  formalKey: '可否信使使用' | '可否蒸汽鸟报使用',
): boolean | undefined {
  const legacyKey = formalKey === '可否信使使用' ? '可否手机使用' : '可否新闻使用';
  const value = entry[formalKey] ?? entry[legacyKey];
  return typeof value === 'boolean' ? value : undefined;
}

export function readLegacyCodexChannelRank(type: string): number | undefined {
  if (type.includes('手机')) return 70;
  if (type.includes('新闻')) return 80;
  return undefined;
}

export function readLegacyNpcCourierAvatar(source: Record<string, unknown>): string | undefined {
  for (const key of ['手机', '小手机', 'phone', 'mobile']) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function readLegacyNpcMemorySource(raw: unknown): '信使' | '蒸汽鸟报' | undefined {
  if (raw === '手机') return '信使';
  if (raw === '新闻') return '蒸汽鸟报';
  return undefined;
}

const LEGACY_CODEX_CHARACTER_ENTRY_ID_PREFIXES = [
  'codex_amphoreus_characters_',
  'codex_express_characters_',
  'codex_express_support_characters_',
  'codex_faction_characters_',
  'codex_genius_society_characters_',
  'codex_jarilo_vi_characters_',
  'codex_penacony_characters_',
  'codex_xianzhou_alliance_characters_',
  'codex_xianzhou_luofu_characters_',
] as const;

export function isLegacyCodexCharacterEntryId(id: string): boolean {
  return LEGACY_CODEX_CHARACTER_ENTRY_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}
