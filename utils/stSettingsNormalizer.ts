/**
 * ST 预设保留式规范化函数（Phase 8 新增）。
 *
 * 参照 MoRanJiangHu utils/tavernPreset.ts 的"字段级软读取"策略，
 * 对 ST 预设 JSON 做宽松解析，容错处理类型不一致、字段缺失等常见问题。
 */

import type { STPreset, STPresetPrompt, STPresetOrder, STPresetOrderSlot, STPresetEntryV2, STSamplingParams } from '@/models/stTypes';
import { readTrimmedText as readText } from '@/utils/valueGuards';

// ── 字段级软读取工具 ──────────────────────────────────────────────

const readBool = (v: unknown): boolean =>
  v === true;

const readFiniteNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const readInt = (v: unknown): number | null => {
  const value = readFiniteNumber(v);
  return value === null ? null : Math.floor(value);
};

// ── 导入白名单 ───────────────────────────────────────────────────
// ST 预设 JSON 由第三方提供，只有下面这些字段会被本项目消费。
// 其余键（任意自定义属性、体积巨大的附属数据等）一律不进入 settings，
// 避免导入文件的未知内容被持久化并随存档/云备份流出。

const ST_PRESET_FIELDS = [
  'prompts',
  'prompt_order',
  'world_info',
  'regex_scripts',
  'temperature',
  'top_p',
  'top_k',
  'top_a',
  'min_p',
  'max_tokens',
  'openai_max_tokens',
  'openai_max_context',
  'max_context',
  'repetition_penalty',
  'frequency_penalty',
  'presence_penalty',
  'assistant_prefill',
] as const;

const ST_PROMPT_FIELDS = [
  'identifier',
  'name',
  'role',
  'content',
  'marker',
  'system_prompt',
  'injection_position',
  'injection_depth',
  'injection_order',
  'forbid_overrides',
] as const;

/** 只复制白名单里的自有属性，其余键（含 __proto__ 之类的注入键）直接丢弃。 */
function pickKnownFields(source: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    const value = source[field];
    if (typeof value === 'undefined') continue;
    picked[field] = value;
  }
  return picked;
}

// ── 规范化单个 prompt ────────────────────────────────────────────

export function normalizeSTPrompt(raw: unknown): STPresetPrompt | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const identifier = readText(obj.identifier);
  if (!identifier) return null;

  const roleRaw = readText(obj.role).toLowerCase();
  const role: STPresetPrompt['role'] =
    roleRaw === 'user' || roleRaw === 'assistant'
      ? roleRaw
      : 'system';

  const content = readText(obj.content) || readText(obj.prompt) || '';
  const marker = readBool(obj.marker);
  // ST 的运行时槽位通常 marker=true 且正文为空。它们不是无效提示词，
  // prompt_order 会借这些槽位注入玩家档案、聊天历史、世界书和本轮输入。
  if (!content && !marker) return null;

  return {
    ...pickKnownFields(obj, ST_PROMPT_FIELDS),
    identifier,
    name: readText(obj.name) || readText(obj.title) || undefined,
    role,
    content,
    marker: readBool(obj.marker),
    system_prompt: readBool(obj.system_prompt),
    injection_position: readInt(obj.injection_position) ?? undefined,
    injection_depth: readInt(obj.injection_depth) ?? undefined,
    injection_order: readInt(obj.injection_order) ?? undefined,
    forbid_overrides: readBool(obj.forbid_overrides) ?? undefined,
  };
}

// ── 规范化单个 order 组 ──────────────────────────────────────────

export function normalizeSTOrder(raw: unknown): STPresetOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  // 部分 ST 前端导出的通用预设省略 character_id；酒馆自己的通用默认值是 100001。
  const characterId = readInt(obj.character_id) ?? 100001;

  const orderRaw = Array.isArray(obj.order) ? obj.order : [];
  const order: STPresetOrderSlot[] = orderRaw
    .map((slot: unknown) => {
      if (!slot || typeof slot !== 'object') return null;
      const s = slot as Record<string, unknown>;
      const identifier = readText(s.identifier);
      if (!identifier) return null;
      return {
        identifier,
        enabled: s.enabled !== false,
      };
    })
    .filter((slot): slot is STPresetOrderSlot => slot !== null);

  return { character_id: characterId, order };
}

// ── 顶层采样参数提取 ─────────────────────────────────────────────

interface SamplingParams {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  repetition_penalty?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

function extractSamplingParams(obj: Record<string, unknown>): SamplingParams {
  return {
    temperature: readFiniteNumber(obj.temperature) ?? undefined,
    top_p: readFiniteNumber(obj.top_p) ?? undefined,
    top_k: readFiniteNumber(obj.top_k) ?? undefined,
    max_tokens: readFiniteNumber(obj.max_tokens ?? obj.openai_max_tokens) ?? undefined,
    repetition_penalty: readFiniteNumber(obj.repetition_penalty) ?? undefined,
    frequency_penalty: readFiniteNumber(obj.frequency_penalty) ?? undefined,
    presence_penalty: readFiniteNumber(obj.presence_penalty) ?? undefined,
  };
}

/** 将 ST 顶层 snake_case 采样参数映射为项目 API 配置字段。 */
export function extractSTPresetSamplingParams(preset: STPreset | Record<string, unknown>): STSamplingParams | undefined {
  const obj = preset as Record<string, unknown>;
  const params: STSamplingParams = {
    temperature: readFiniteNumber(obj.temperature) ?? undefined,
    topP: readFiniteNumber(obj.top_p) ?? undefined,
    topK: readFiniteNumber(obj.top_k) ?? undefined,
    topA: readFiniteNumber(obj.top_a) ?? undefined,
    minP: readFiniteNumber(obj.min_p) ?? undefined,
    repetitionPenalty: readFiniteNumber(obj.repetition_penalty) ?? undefined,
    frequencyPenalty: readFiniteNumber(obj.frequency_penalty) ?? undefined,
    presencePenalty: readFiniteNumber(obj.presence_penalty) ?? undefined,
    maxContext: readFiniteNumber(obj.openai_max_context ?? obj.max_context) ?? undefined,
    maxTokens: readFiniteNumber(obj.openai_max_tokens ?? obj.max_tokens) ?? undefined,
  };
  return Object.values(params).some((value) => value !== undefined) ? params : undefined;
}

// ── 规范化单个 ST 预设 ───────────────────────────────────────────

function findSTPresetPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const envelopeKeys = ['preset', 'data', 'settings'] as const;
  const queue: Array<{ value: Record<string, unknown>; depth: number }> = [{ value: raw, depth: 0 }];
  const visited = new Set<Record<string, unknown>>();
  while (queue.length) {
    const current = queue.shift()!;
    if (visited.has(current.value)) continue;
    visited.add(current.value);
    if (Array.isArray(current.value.prompts) || Array.isArray(current.value.prompt_order)) return current.value;
    if (current.depth >= 4) continue;
    for (const key of envelopeKeys) {
      const nested = current.value[key];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        queue.push({ value: nested as Record<string, unknown>, depth: current.depth + 1 });
      }
    }
  }
  return raw;
}

export function normalizeSTPreset(raw: unknown): STPreset | null {
  if (!raw || typeof raw !== 'object') return null;
  const root = raw as Record<string, unknown>;
  // 兼容预设库/第三方工具常见的 preset/data/settings 多层包装。
  const obj = findSTPresetPayload(root);

  const prompts = Array.isArray(obj.prompts)
    ? obj.prompts.map(normalizeSTPrompt).filter((p): p is STPresetPrompt => p !== null)
    : [];
  const promptOrder = Array.isArray(obj.prompt_order)
    ? obj.prompt_order.map(normalizeSTOrder).filter((o): o is STPresetOrder => o !== null)
    : [];

  if (prompts.length === 0 || promptOrder.length === 0) return null;

  return {
    ...pickKnownFields(obj, ST_PRESET_FIELDS),
    prompts,
    prompt_order: promptOrder,
    ...extractSamplingParams(obj),
  };
}

// ── 规范化 ST 预设列表 ───────────────────────────────────────────

export function normalizeSTPresetList(raw: unknown): STPresetEntryV2[] {
  const listRaw = Array.isArray(raw) ? raw : [];
  return listRaw.reduce<STPresetEntryV2[]>((acc, item, index) => {
    if (!item || typeof item !== 'object') return acc;
    const src = item as Record<string, unknown>;

    const preset = normalizeSTPreset(src.preset ?? src.预设 ?? src);
    if (!preset) return acc;

    const idRaw = readText(src.id);
    const id = idRaw || `preset_${index + 1}`;

    const nameRaw = readText(src.名称) || readText(src.name);
    const name = nameRaw || `酒馆预设${index + 1}`;

    acc.push({
      id,
      name,
      preset,
      characterId: readInt(src.角色ID ?? src.characterId) ?? undefined,
      importedAt: typeof src.导入时间 === 'number' && Number.isFinite(src.导入时间)
        ? Math.floor(src.导入时间)
        : Date.now(),
      updatedAt: Date.now(),
      isBuiltin: readBool(src.isBuiltin),
    });
    return acc;
  }, []);
}

// ── 规范化游戏设置中的 ST 字段 ───────────────────────────────────

export function normalizeSTSettings(settings: Record<string, unknown>): {
  stPresetsV2: STPresetEntryV2[];
  currentStPresetIdV2: string | null;
  currentStCharacterId: number | null;
} {
  const presetList = normalizeSTPresetList(settings.stPresetsV2);

  const selectedIdRaw = readText(settings.currentStPresetIdV2 ?? settings.currentStPresetId).trim();
  const selectedEntry = selectedIdRaw
    ? presetList.find((p) => p.id === selectedIdRaw) || null
    : null;

  const characterId = readInt(
    settings.currentStCharacterId ?? selectedEntry?.characterId
  ) ?? null;

  return {
    stPresetsV2: presetList,
    currentStPresetIdV2: selectedEntry?.id || null,
    currentStCharacterId: characterId,
  };
}

export function getCurrentSTPresetV2(settings: {
  stPresetsV2?: STPresetEntryV2[];
  currentStPresetIdV2?: string | null;
}, extraPresets: STPresetEntryV2[] = []): STPresetEntryV2 | null {
  const presetList = [
    ...extraPresets,
    ...(Array.isArray(settings.stPresetsV2) ? settings.stPresetsV2 : []),
  ];
  const id = readText(settings.currentStPresetIdV2).trim();
  if (!id) return null;
  return presetList.find((entry) => entry.id === id) ?? null;
}
