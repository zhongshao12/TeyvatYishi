import type { 图鉴系统, 图鉴条目 } from '@/models/codex';
import { isLegacyCodexCharacterEntryId } from '@/compat/legacy-hsr/readOnly';
import {
  isRetiredCodexCategory,
  获取图鉴条目身份ID,
  归一化图鉴系统,
} from '@/models/codex';
import {
  CODEX_CUSTOM_SCHEMA_VERSION,
  获取下一个自制图鉴序号,
  迁移自制图鉴条目,
} from './codexCustomGovernance';
import { resolveBundledCodexIdentity } from './codexIdentityRegistry';

export interface BundledCodexPreset {
  id: string;
  title: string;
  description: string;
  path: string;
  updatedAt?: string;
}

export interface LoadBundledCodexOptions {
  cacheBust?: string | number;
}

export const CODEX_CHARACTER_REBUILD_MIGRATION_KEY = 'codexCharacterRebuildMigrationAt';
export const CODEX_CHARACTER_REBUILD_ENTRY_ID_PREFIX = 'codex_character_rebuild_';
export const CODEX_CHARACTER_EXPANSION_ENTRY_ID_PREFIX = 'codex_character_expansion_';
export const bundledCodexPresets: BundledCodexPreset[] = [
  {
    id: 'codex_teyvat_worldview_core',
    title: '提瓦特纪闻·世界骨架',
    description: '七国、七执政、元素与神之眼、世界树与深渊的基础资料。',
    path: '/codex-presets/teyvat-worldview-core.json',
    updatedAt: '2026-08-02-teyvat-core-1',
  },
  {
    id: 'codex_teyvat_location_core',
    title: '北陆图书馆·地理志',
    description: '提瓦特八域地理志：蒙德、璃月、稻妻、须弥、枫丹、纳塔、挪德卡莱与空之神殿的全部图鉴地点与介绍。',
    path: '/codex-presets/teyvat-location-core.json',
    updatedAt: '2026-08-02-teyvat-geography-1',
  },
  {
    id: 'codex_teyvat_term_core',
    title: '提瓦特术语·总览资料',
    description: '神之眼、元素反应、圣遗物、冒险家协会、深境螺旋、尘歌壶等高频术语的内置资料。',
    path: '/codex-presets/teyvat-term-core.json',
    updatedAt: '2026-08-02-teyvat-core-1',
  },
  {
    id: 'codex_teyvat_characters_core',
    title: '北陆图书馆·原神角色与 NPC 档案',
    description: '原神全部可玩角色与主要 NPC 的结构化档案：身份、性格、说话方式、外貌、能力边界与演绎红线。',
    path: '/codex-presets/teyvat-characters-core.json',
    updatedAt: '2026-08-02-teyvat-characters-3',
  },
  {
    id: 'codex_teyvat_archons_core',
    title: '北陆图书馆·七神档案',
    description: '尘世七执政（七神）的详细档案：神名、理念、国度、神之心、外貌、性格与演绎边界。',
    path: '/codex-presets/teyvat-archons-core.json',
    updatedAt: '2026-08-02-teyvat-archons-2',
  },
  {
    id: 'codex_teyvat_elements_core',
    title: '北陆图书馆·元素力档案',
    description: '提瓦特七种元素力与深渊、无元素的详细描写。',
    path: '/codex-presets/teyvat-elements-core.json',
    updatedAt: '2026-08-02-teyvat-elements-2',
  },
];

const BUNDLED_MAIN_STORY_TITLES = new Set([
  '序章·蒙德·捕风的异乡人',
  '序章·蒙德·为了没有眼泪的明天',
  '序章·蒙德·巨龙与自由之歌',
  '第一章·璃月·浮世浮生千岩间',
  '第一章·璃月·辞行久远之躯',
  '第一章·璃月·迫近的客星',
  '第一章·璃月·千岩牢固，重嶂不移',
  '第二章·稻妻·不动鸣神，恒常乐土',
  '第二章·稻妻·无念无想，泡影断灭',
  '第二章·稻妻·千手百目，天下人间',
  '第二章·稻妻·回响渊底的安魂曲',
  '第三章·须弥·穿越烟帷与暗林',
  '第三章·须弥·千朵玫瑰带来的黎明',
  '第三章·须弥·梦中的苗圃',
  '第三章·须弥·虚空鼓动，劫火高扬',
  '第四章·枫丹·白露与黑泉的序诗',
  '第四章·枫丹·仿若无因飘落的轻雨',
  '第四章·枫丹·向深水中的晨星',
  '第四章·枫丹·谕示胎动的终焉之刻',
  '第五章·纳塔·炽烈的还魂诗',
  '间章·风起鹤归',
  '间章·危途疑踪',
  '间章·倾落伽蓝',
]);

const LINKABLE_MIGRATED_LORE_PRESET_IDS = new Set([
  'codex_teyvat_worldview_core',
]);

function normalizeMigratedLoreEntry(entry: 图鉴条目, preset: BundledCodexPreset, index: number): Partial<图鉴条目> {
  const isTeyvatWorldview = preset.id === 'codex_teyvat_worldview_core';
  const isLockedTeyvatWorldview = isTeyvatWorldview && index >= 2;
  return {
    资料类型: entry.资料类型 || '迁移设定资料',
    解锁状态: entry.解锁状态 || (isLockedTeyvatWorldview ? '未解锁' : '默认可用'),
    解锁条件: entry.解锁条件 || (isLockedTeyvatWorldview ? '推进到稻妻相关剧情后由剧情编织归档解锁' : undefined),
    剧透等级: entry.剧透等级 || (preset.id === 'codex_paths_core' ? '中度' : '重大'),
    使用范围: entry.使用范围?.length ? entry.使用范围 : ['图鉴', '设定浏览', '主剧情'],
    可否主剧情注入: entry.可否主剧情注入 ?? true,
    重要度: Math.min(Number(entry.重要度) || 3, 3),
  };
}

export function isBundledCodexDuplicate(entry: Partial<图鉴条目>): boolean {
  if (entry.builtin) return false;
  if (entry.分类 !== 'story') return false;

  const title = typeof entry.标题 === 'string' ? entry.标题.trim() : '';
  const source = typeof entry.来源 === 'string' ? entry.来源 : '';
  const raw = typeof entry.原文 === 'string' ? entry.原文 : '';

  if (source.includes('旅行者纪事·项目内置剧情')) return true;
  if (BUNDLED_MAIN_STORY_TITLES.has(title)) return true;
  if (source.includes('剧情-蒙德')) return true;
  return title.includes('蒙德') && raw.includes('捕风的异乡人');
}

export function shouldRemoveRetiredCodexEntry(entry: Partial<图鉴条目>): boolean {
  return Boolean(entry.分类 && isRetiredCodexCategory(entry.分类));
}

export function removeRetiredCodexEntries(entries: 图鉴条目[] | undefined): 图鉴条目[] {
  return (entries ?? []).filter((entry) => !shouldRemoveRetiredCodexEntry(entry));
}

export function shouldRemoveLegacyCodexCharacterEntry(entry: Partial<图鉴条目>, migrationAt: number): boolean {
  if (entry.分类 !== 'character') return false;
  if (isRebuiltCodexCharacterEntry(entry)) return false;
  if (entry.builtin) return true;
  void migrationAt;
  return 获取图鉴条目身份ID(entry as Pick<图鉴条目, 'id' | '兼容ID'>)
    .some(isLegacyCodexCharacterEntryId);
}

export function removeLegacyCodexCharacterEntries(
  entries: 图鉴条目[] | undefined,
  migrationAt: number,
): 图鉴条目[] {
  return (entries ?? []).filter((entry) => !shouldRemoveLegacyCodexCharacterEntry(entry, migrationAt));
}

export function isRebuiltCodexCharacterEntry(entry: Partial<图鉴条目>): boolean {
  return 获取图鉴条目身份ID(entry as Pick<图鉴条目, 'id' | '兼容ID'>)
    .some((id) => (
      id.startsWith(CODEX_CHARACTER_REBUILD_ENTRY_ID_PREFIX)
      || id.startsWith(CODEX_CHARACTER_EXPANSION_ENTRY_ID_PREFIX)
    ));
}

function normalizeCodexEntriesIndividually(entries: readonly Partial<图鉴条目>[]): 图鉴条目[] {
  return entries.flatMap((entry) => 归一化图鉴系统({ 条目: [entry as 图鉴条目] }).条目);
}

export function 升级自制图鉴系统(system: 图鉴系统 | null | undefined): 图鉴系统 {
  const entries = normalizeCodexEntriesIndividually(system?.条目 ?? []);
  const reservedEntries = entries.filter((entry) => entry.builtin);
  const migrated = 迁移自制图鉴条目(
    entries.filter((entry) => !entry.builtin),
    reservedEntries,
  ).entries;
  let customIndex = 0;
  const nextSequence = 获取下一个自制图鉴序号(
    migrated,
    system?.自制资料下一个序号 ?? 0,
  );
  return 归一化图鉴系统({
    自制资料契约版本: CODEX_CUSTOM_SCHEMA_VERSION,
    自制资料下一个序号: nextSequence,
    条目: entries.map((entry) => (entry.builtin ? entry : migrated[customIndex++])),
  });
}

export function mergeCodexRuntimeUnlockOverrides(
  bundledEntries: 图鉴条目[],
  savedEntries: 图鉴条目[] | undefined,
): 图鉴条目[] {
  const savedById = new Map<string, 图鉴条目>();
  for (const entry of savedEntries ?? []) {
    if (!entry.id || (!entry.运行时解锁状态 && !entry.运行时解锁备注)) continue;
    for (const id of 获取图鉴条目身份ID(entry)) savedById.set(id, entry);
  }
  return bundledEntries.map((entry) => {
    const saved = 获取图鉴条目身份ID(entry)
      .map((id) => savedById.get(id))
      .find((candidate): candidate is 图鉴条目 => Boolean(candidate));
    if (!saved) return entry;
    return {
      ...entry,
      运行时解锁状态: saved.运行时解锁状态,
      运行时解锁备注: saved.运行时解锁备注,
    };
  });
}

export function mergeBundledCodexSystem(
  bundledSystem: 图鉴系统,
  currentSystem: 图鉴系统 | null | undefined,
  migrationAt: number,
): 图鉴系统 {
  const currentEntries = normalizeCodexEntriesIndividually(currentSystem?.条目 ?? []);
  const customEntriesBeforeIdentityMigration = removeLegacyCodexCharacterEntries(
    removeRetiredCodexEntries(
      currentEntries.filter((entry) => !entry.builtin && !isBundledCodexDuplicate(entry)),
    ),
    migrationAt,
  );
  const customEntries = 迁移自制图鉴条目(customEntriesBeforeIdentityMigration, bundledSystem.条目).entries;
  return 升级自制图鉴系统({
    自制资料契约版本: currentSystem?.自制资料契约版本,
    自制资料下一个序号: currentSystem?.自制资料下一个序号,
    条目: [...mergeCodexRuntimeUnlockOverrides(bundledSystem.条目, currentEntries), ...customEntries],
  });
}

export function buildPersistedCodexSystem(system: 图鉴系统 | undefined): 图鉴系统 {
  const source = 升级自制图鉴系统(system);
  return 归一化图鉴系统({
    自制资料契约版本: source.自制资料契约版本,
    自制资料下一个序号: source.自制资料下一个序号,
    条目: source.条目
      .filter((entry) => !shouldRemoveRetiredCodexEntry(entry))
      .filter((entry) => !entry.builtin || Boolean(entry.运行时解锁状态 || entry.运行时解锁备注))
      .map((entry) => {
        if (!entry.builtin) return entry;
        return {
          id: entry.id,
          兼容ID: entry.兼容ID,
          治理分类: entry.治理分类,
          资料所有者: entry.资料所有者,
          来源预设ID: entry.来源预设ID,
          来源文件: entry.来源文件,
          来源序号: entry.来源序号,
          资料版本: entry.资料版本,
          辅助字段版本: entry.辅助字段版本,
          标题: entry.标题,
          分类: entry.分类,
          摘要: '',
          原文: '',
          来源: entry.来源,
          关键词: [],
          运行时解锁状态: entry.运行时解锁状态,
          运行时解锁备注: entry.运行时解锁备注,
          关联条目ID: [],
          重要度: entry.重要度,
          可用于联动: entry.可用于联动,
          builtin: true,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        };
      }),
  });
}

export async function loadBundledCodexPreset(preset: BundledCodexPreset, options: LoadBundledCodexOptions = {}): Promise<图鉴系统> {
  const separator = preset.path.includes('?') ? '&' : '?';
  const cacheBust = options.cacheBust !== undefined ? `&r=${encodeURIComponent(String(options.cacheBust))}` : '';
  const res = await fetch(`${preset.path}${separator}v=${encodeURIComponent(preset.updatedAt ?? preset.id)}${cacheBust}`);
  if (!res.ok) {
    throw new Error(`加载图鉴预设失败：${preset.title}（${res.status}）`);
  }
  const data = await res.json() as { entries?: unknown[] };
  const entries = Array.isArray(data.entries) ? (data.entries as unknown as 图鉴条目[]) : [];
  const seriesOrder = bundledCodexPresets.findIndex((item) => item.id === preset.id) + 1;
  const isLinkableMigratedLore = LINKABLE_MIGRATED_LORE_PRESET_IDS.has(preset.id);
  return 归一化图鉴系统({
    条目: entries
      .filter((entry) => !shouldRemoveRetiredCodexEntry(entry))
      .filter((entry) => entry.分类 !== 'character' || isRebuiltCodexCharacterEntry(entry))
      .map((entry, index) => {
        const legacyId = entry.id || `${preset.id}_${index + 1}`;
        const identity = resolveBundledCodexIdentity(preset.id, index, entry.id, entry.标题);
        return {
          ...entry,
          ...(isLinkableMigratedLore
            ? normalizeMigratedLoreEntry(entry, preset, index)
            : {}),
          id: identity?.id ?? legacyId,
          兼容ID: identity
            ? [...new Set([...(entry.兼容ID ?? []), identity.legacyId])]
            : entry.兼容ID,
          治理分类: identity?.category ?? entry.治理分类,
          资料所有者: 'builtin-json' as const,
          来源预设ID: preset.id,
          来源文件: identity?.sourceFile ?? preset.path.replace(/^\/codex-presets\//u, ''),
          来源序号: index,
          ...(entry.分类 === 'story'
            ? {
                系列ID: entry.系列ID || preset.id,
                系列标题: entry.系列标题 || preset.title,
                系列序号: entry.系列序号 || seriesOrder,
                章节序号: entry.章节序号 || index + 1,
              }
            : entry.分类 === 'character'
              ? {
                  系列ID: entry.系列ID || preset.id,
                  系列标题: entry.系列标题 || preset.title,
                  系列序号: entry.系列序号 || seriesOrder,
                }
              : {}),
          builtin: true,
        };
      }),
  });
}

export async function loadAllBundledCodexPresets(options: LoadBundledCodexOptions = {}): Promise<图鉴系统> {
  const systems = await Promise.all(bundledCodexPresets.map((preset) => loadBundledCodexPreset(preset, options)));
  return 归一化图鉴系统({
    条目: systems.flatMap((system) => system.条目),
  });
}
