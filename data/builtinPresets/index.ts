/**
 * Phase 7：内置预设注册表
 *
 * 管理所有内置预设（原生 + 二创成品）。玩家导入的预设不在本注册表内，
 * 它们运行时存在 state.gameSettings.stPresets 里。
 *
 * 内置预设特性：
 * - isBuiltin=true：不可删不可导入
 * - presetType：'native'（原生内置）/ 'adapted'（二创成品）
 * - 二创成品以 JSON 文件形式存储，已手工融合，不需要运行时融合
 *
 * 按需加载：三个二创成品预设（共约 3MB）存放在 public/data/builtin-presets/，
 * 运行时 fetch 加载（与剧情编织原著资源同一模式），不再打进 JS 主包。
 * 未加载完成前，getBuiltinPresetsV2 返回空 preset 占位；加载完成后内容填充。
 */

import type { STMessageRole, STPreset, STPresetEntry, STPresetEntryV2, STPresetPrompt } from '@/models/stTypes';
import { createBuiltinPresetEntry } from './builtinPreset';

export const BUILTIN_SHUANGRENCHENGHANG_PRESET_ID = 'builtin_shuangrenchenghang_v2';
export const BUILTIN_IZUMI_PRESET_ID = 'builtin_izumi_v2';
export const BUILTIN_SANRENNIXING_PRESET_ID = 'builtin_sanrennixing_v2';

interface BuiltinTavernPresetMeta {
  id: string;
  name: string;
}

const BUILTIN_TAVERN_PRESET_META: readonly BuiltinTavernPresetMeta[] = [
  { id: BUILTIN_SHUANGRENCHENGHANG_PRESET_ID, name: '双人成行v10.0—青云上' },
  { id: BUILTIN_IZUMI_PRESET_ID, name: 'Izumi 0629' },
  { id: BUILTIN_SANRENNIXING_PRESET_ID, name: '三人逆行v12.0' },
];

const EMPTY_ST_PRESET: STPreset = { prompts: [], prompt_order: [] };

const builtinTavernPresetCache = new Map<string, STPreset>();
let builtinTavernPresetsLoading: Promise<void> | null = null;

/**
 * 获取所有内置预设。
 *
 * 返回顺序：原生内置预设在前，二创成品预设在后。
 * UI 层可据此排序展示。
 */
export function getBuiltinPresets(): STPresetEntry[] {
  return [
    createBuiltinPresetEntry(),
  ];
}

/**
 * 判断预设 id 是否为内置预设。
 */
export function isBuiltinPreset(id: string): boolean {
  return getBuiltinPresets().some((p) => p.id === id);
}

/**
 * 根据 id 获取内置预设。找不到返回 undefined。
 */
export function getBuiltinPresetById(id: string): STPresetEntry | undefined {
  return getBuiltinPresets().find((p) => p.id === id);
}

function normalizeMessageRole(role: unknown): STMessageRole {
  return role === 'user' || role === 'assistant' ? role : 'system';
}

function toV2PromptIdentifier(moduleId: string, index: number): string {
  return moduleId.replace(/^st_import_/, '').replace(/^adapted_/, 'adapted_') || `prompt_${index + 1}`;
}

function convertBuiltinPresetToV2(entry: STPresetEntry): STPresetEntryV2 | null {
  if (entry.presetType === 'native' || entry.modules.length === 0) return null;
  const prompts: STPresetPrompt[] = entry.modules
    .filter((module) => module.enabled !== false)
    .filter((module) => typeof module.content === 'string' && module.content.trim())
    .map((module, index) => ({
      identifier: toV2PromptIdentifier(module.id, index),
      name: module.title,
      role: normalizeMessageRole(module.role),
      content: module.content,
      injection_position: module.injectionPosition,
      injection_depth: module.injectionDepth,
      injection_order: module.injectionOrder,
    }));
  if (prompts.length === 0) return null;
  return {
    id: `${entry.id}_v2`,
    name: `${entry.name} · V2消息链`,
    preset: {
      prompts,
      prompt_order: [{
        character_id: 100001,
        order: prompts.map((prompt) => ({ identifier: prompt.identifier, enabled: true })),
      }],
    },
    characterId: 100001,
    importedAt: entry.importedAt,
    updatedAt: entry.updatedAt,
    isBuiltin: true,
  };
}

function getBuiltinTavernPresetUrl(presetId: string): string {
  const relativePath = `data/builtin-presets/${presetId}.json`;
  if (typeof document !== 'undefined') {
    const moduleScriptUrl = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
    if (moduleScriptUrl) return new URL(`../${relativePath}`, moduleScriptUrl).toString();
    return new URL(`/${relativePath}`, document.location.origin).toString();
  }
  return `/${relativePath}`;
}

async function fetchBuiltinTavernPreset(presetId: string): Promise<STPreset | null> {
  let lastError: unknown;
  for (const cache of ['force-cache', 'reload'] as const) {
    try {
      const response = await fetch(getBuiltinTavernPresetUrl(presetId), { cache });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json() as STPreset;
    } catch (error) {
      lastError = error;
    }
  }
  console.warn(`[builtin-presets] 内置酒馆预设加载失败：${presetId}`, lastError);
  return null;
}

export function isBuiltinTavernPresetId(id: string): boolean {
  return BUILTIN_TAVERN_PRESET_META.some((meta) => meta.id === id);
}

export function isBuiltinTavernPresetLoaded(id: string): boolean {
  return builtinTavernPresetCache.has(id);
}

/** 加载单个内置酒馆预设；已加载时立即返回。 */
export async function loadBuiltinTavernPreset(presetId: string): Promise<boolean> {
  if (builtinTavernPresetCache.has(presetId)) return true;
  if (!isBuiltinTavernPresetId(presetId)) return false;
  const preset = await fetchBuiltinTavernPreset(presetId);
  if (!preset) return false;
  builtinTavernPresetCache.set(presetId, preset);
  return true;
}

/** 顺序加载全部内置酒馆预设（带内存缓存与并发去重）。 */
export async function loadAllBuiltinTavernPresets(): Promise<void> {
  if (builtinTavernPresetsLoading) return builtinTavernPresetsLoading;
  const run = async (): Promise<void> => {
    for (const meta of BUILTIN_TAVERN_PRESET_META) {
      if (builtinTavernPresetCache.has(meta.id)) continue;
      const preset = await fetchBuiltinTavernPreset(meta.id);
      if (preset) builtinTavernPresetCache.set(meta.id, preset);
      // 逐个解析并让出主线程，避免 3MB JSON 一次性解析造成卡顿。
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  };
  builtinTavernPresetsLoading = run();
  try {
    await builtinTavernPresetsLoading;
  } finally {
    builtinTavernPresetsLoading = null;
  }
}

export function getBuiltinPresetsV2(): STPresetEntryV2[] {
  const converted = getBuiltinPresets()
    .map(convertBuiltinPresetToV2)
    .filter((entry): entry is STPresetEntryV2 => entry !== null);
  return [
    ...converted,
    ...BUILTIN_TAVERN_PRESET_META.map((meta) => ({
      id: meta.id,
      name: meta.name,
      preset: builtinTavernPresetCache.get(meta.id) ?? EMPTY_ST_PRESET,
      characterId: 100001,
      importedAt: 0,
      updatedAt: 0,
      isBuiltin: true,
    })),
  ];
}
