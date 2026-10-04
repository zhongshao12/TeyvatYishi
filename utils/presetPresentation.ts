/**
 * 酒馆预设「表现层契约」解析（2026-10-03）。
 *
 * 背景（用户实测反馈）：「预设还是没有起到作用：1.字数没有达标，2.文风没有启动」。
 * 排查结论：应用的内置默认值仍然在生成点附近与预设争夺同一件事 ——
 *
 *  1. 字数：内置《NarrativeTurn JSON 回复格式》模块用 `{wordCountTarget}`（默认 500）声明正文下限，
 *     而预设自己的「至少 3000 字」写在更早的消息里；谁在生成点附近说得更具体，模型就听谁的。
 *  2. 文风：内置《文风参考·日记体见闻录》会被 `buildWorldbookText` 塞进**预设消息链内部**
 *     （World Info (before) 槽位），于是在预设自己的链里变成了文风权威。
 *  3. 外壳：预设的作者把「思维链/正文/摘要/角色表」做成了变量 + 标签外壳
 *     （`{{setvar::正文标签::<content>…}}` 之类），应用的内置格式守卫却说「禁止 thinking」，
 *     模型于是两样都不做；而预设真正要求的那段 CoT 属于**可见内容**，本该落进 system 块。
 *
 * 本模块只做一件事：把「这个预设到底要求什么」解析成结构，供：
 *  - `systemPromptBuilder` 替换 `{wordCountTarget}`（字数下限以预设为准）；
 *  - `tavernMessageChainBuilder` 修正内置格式守卫 + 生成点执行卡；
 *  - `apiMessagesStage` 追加最后一条执行卡（离生成点最近）；
 *  - `mainPromptAssembly` 给玩家一份「预设表现层」诊断（含未勾选的文风模块名单）。
 *
 * 解析完全基于预设自身的文本与变量，不引入任何猜测性默认值。
 */

import type { STPreset, STPresetEntryV2, STPresetOrder, STPresetOrderSlot, STPresetPrompt } from '@/models/stTypes';
import { collectMacroAssignments, createMacroContext, processMacros } from '@/utils/macroEngine';
import { getCurrentSTPresetV2 } from '@/utils/stSettingsNormalizer';

export type PresetShellKind = 'body' | 'thinking' | 'summary' | 'table' | 'panel';

/** 预设声明的输出外壳标签 → 应用载体字段的映射来源。 */
export interface PresetShellSegment {
  /** 标签名，如 content / thinking / meow_FM / char_date。 */
  tag: string;
  kind: PresetShellKind;
  /** 解析来源（变量名或条目名），用于诊断与测试。 */
  source: string;
}

export interface PresetPresentation {
  presetId: string;
  presetName: string;
  /** 预设要求的正文汉字下限（解析到位才非 null）。 */
  wordCountTarget: number | null;
  /** 原始表述，例如「至少3000」。 */
  wordCountRaw: string;
  /** 解析来源，例如「变量 字数要求」/「条目 📚字数要求(固定字数)」。 */
  wordCountSource: string;
  /** 预设声明的输出外壳标签。 */
  shell: PresetShellSegment[];
  /** 预设自己的文风/基调正文（仅当〈文风〉段里确实有内容；截断到 1600 字）。 */
  styleText: string;
  /** 〈文风〉段为空时，从预设其余条目抽出的表现要求（人称/语气/语言/节奏）。 */
  styleDirectives: string;
  /** 有内容的段名（`<文风>`/`<故事基调>` 等）。 */
  filledSegments: string[];
  /** 空段名：预设开了包装标签，但里面没有内容（玩家没勾选填充模块）。 */
  emptySegments: string[];
  /** 表现段（文风/风格/基调）里**有**内容的段名。 */
  styleSegmentsFilled: string[];
  /** 表现段里**没有**内容的段名 —— 玩家没勾填充模块的直接证据。 */
  styleSegmentsEmpty: string[];
  /** 已关闭、但看名字就是文风/基调填充器的条目名 —— 玩家一键自查用。 */
  disabledStyleCandidates: string[];
  /** 预设是否要求可见思维链/分析。 */
  cotRequested: boolean;
  /** 预设声明的起手式样例。 */
  assistantPrefill: string;
}

export interface PresetPresentationSettings {
  stPresetsV2?: STPresetEntryV2[];
  currentStPresetIdV2?: string | null;
  currentStCharacterId?: number | null;
  enableStPreset?: boolean;
}

// ── 缓存：预设对象是不可变替换的，WeakMap 天然随编辑失效 ──────────────
const presentationCache = new WeakMap<object, Map<string, PresetPresentation>>();

const MAX_STYLE_CHARS = 1600;
const MAX_WORD_TARGET = 20000;
const MIN_WORD_TARGET = 100;

// ── 顺序槽位 ─────────────────────────────────────────────────────
export function selectPresetOrderSlots(preset: STPreset, characterId: number | null): STPresetOrderSlot[] {
  const orders = Array.isArray(preset?.prompt_order) ? preset.prompt_order : [];
  if (orders.length === 0) return [];
  const order: STPresetOrder | null =
    (characterId !== null ? orders.find((item) => item.character_id === characterId) ?? null : null)
    ?? orders.find((item) => item.character_id === 100001)
    ?? orders[0]
    ?? null;
  if (!order || !Array.isArray(order.order)) return [];
  return order.order.filter((slot): slot is STPresetOrderSlot => Boolean(slot) && slot.enabled !== false);
}

// ── 主入口 ───────────────────────────────────────────────────────
export function resolvePresetPresentation(settings: PresetPresentationSettings | undefined): PresetPresentation | null {
  if (!settings || settings.enableStPreset === false) return null;
  const entry = getCurrentSTPresetV2(settings);
  const preset = entry?.preset;
  if (!entry || !preset || !Array.isArray(preset.prompts) || preset.prompts.length === 0) return null;

  const characterId = settings.currentStCharacterId ?? entry.characterId ?? null;
  return cachedPresentation(preset, characterId, () => buildPresetPresentation(entry.id, entry.name, preset, characterId));
}

/**
 * 消息链构建路径专用：链的调用方直接持有 `preset` 对象（不一定能从 settings 反查到条目），
 * 因此这里以 preset 本身为解析依据，只在能反查到条目时借用它的名称。
 */
export function buildPresentationForPreset(
  preset: STPreset | undefined | null,
  meta: { presetId?: string; presetName?: string; characterId?: number | null } = {},
): PresetPresentation | null {
  if (!preset || !Array.isArray(preset.prompts) || preset.prompts.length === 0) return null;
  const characterId = meta.characterId ?? null;
  return cachedPresentation(preset, characterId, () => buildPresetPresentation(
    meta.presetId ?? 'chain_preset',
    meta.presetName ?? '当前酒馆预设',
    preset,
    characterId,
  ));
}

function cachedPresentation(
  preset: STPreset,
  characterId: number | null,
  build: () => PresetPresentation,
): PresetPresentation {
  const cacheKey = String(characterId ?? 'default');
  let perPreset = presentationCache.get(preset as unknown as object);
  if (!perPreset) {
    perPreset = new Map<string, PresetPresentation>();
    presentationCache.set(preset as unknown as object, perPreset);
  }
  const cached = perPreset.get(cacheKey);
  if (cached) return cached;
  const built = build();
  perPreset.set(cacheKey, built);
  return built;
}

/** 内置 `{wordCountTarget}` 的实际取值：预设要求更大时以预设为准。 */
export function resolveEffectiveWordCountTarget(
  settings: PresetPresentationSettings | undefined,
  fallback: number,
): number {
  const presentation = resolvePresetPresentation(settings);
  const target = presentation?.wordCountTarget ?? null;
  if (target && target > fallback) return target;
  return fallback;
}

/** 自动抬高输出预算的上限。再高就不由应用猜了（部分模型/渠道会直接拒绝过大的 max_tokens）。 */
export const NARRATIVE_MAX_TOKENS_CEILING = 8192;

/**
 * 按预设的字数下限抬高本回合的输出 token 预算（只抬不降，够用就原样返回）。
 *
 * 为什么不靠预设自带的 `openai_max_tokens`：那个值只在**用界面切换预设**时才会同步进 API 配置
 * （Phase 8 的 applyPresetApiSync）。旧存档/直接改配置的情况下它可能还是 2048 之类的小值，
 * 而预设要求 3000 字正文 —— 请求会被 max_tokens 截断，接着 JSON 解析失败，
 * 玩家看到的就是「字数没达标 + 回复出错」。这里给一个确定性的下限。
 */
export function resolveNarrativeMaxTokens(
  current: number | undefined,
  wordCountTarget: number | null | undefined,
): number | undefined {
  if (typeof wordCountTarget !== 'number' || !Number.isFinite(wordCountTarget)) return current;
  if (wordCountTarget < 1200) return current;
  const needed = Math.min(NARRATIVE_MAX_TOKENS_CEILING, Math.ceil(wordCountTarget * 1.2) + 1200);
  if (typeof current === 'number' && current >= needed) return current;
  return needed;
}

// ── 解析实现 ─────────────────────────────────────────────────────
function buildPresetPresentation(
  presetId: string,
  presetName: string,
  preset: STPreset,
  characterId: number | null,
): PresetPresentation {
  const promptMap = new Map<string, STPresetPrompt>(
    preset.prompts.map((item) => [item.identifier, item] as const),
  );
  const slots = selectPresetOrderSlots(preset, characterId);
  const enabledContents = slots.map((slot) => promptMap.get(slot.identifier)?.content ?? '');

  const macroCtx = createMacroContext(undefined, {});
  collectMacroAssignments(enabledContents, macroCtx);

  const resolvedSlots = slots.map((slot) => {
    const prompt = promptMap.get(slot.identifier);
    const name = prompt?.name?.trim() || slot.identifier;
    const content = prompt ? processMacros(prompt.content ?? '', macroCtx).trim() : '';
    return { identifier: slot.identifier, name, content, isMarker: prompt?.marker === true };
  });
  const deliveredTexts = resolvedSlots.filter((slot) => !slot.isMarker && slot.content);

  // 1. 段落扫描：预设用「开始/结束」两个括号条目把填充模块夹在中间
  //    （`<文风>` … 玩家勾选的文风模块 … `</文风>`），空段就是玩家没勾。
  const segments = collectBracketSegments(resolvedSlots.map((slot) => ({ name: slot.name, text: slot.content })));
  const filledSegments: string[] = [];
  const emptySegments: string[] = [];
  const styleSegmentsFilled: string[] = [];
  const styleSegmentsEmpty: string[] = [];
  for (const [name, text] of segments) {
    if (text.trim()) {
      filledSegments.push(name);
      if (STYLE_SEGMENT_RE.test(name)) styleSegmentsFilled.push(name);
    } else {
      emptySegments.push(name);
      if (STYLE_SEGMENT_RE.test(name)) styleSegmentsEmpty.push(name);
    }
  }

  // 2. 字数：先看变量（MoM 系预设把字数放在 {{setvar::字数要求::至少3000}} 里），再看正文里的自然语句。
  const word = extractWordRequirement(macroCtx.local, deliveredTexts.map((slot) => ({ name: slot.name, text: slot.content })));

  // 3. 输出外壳：预设把每个外壳标签也做成了变量（正文标签/摘要标签/cot头/cot尾/角色表…）。
  const shell = extractShellSegments(macroCtx.local, deliveredTexts.map((slot) => slot.content));

  // 4. 文风正文：只有非空 `<文风>`/`<故事基调>` 段才算「预设提供了文风」；
  //    段是空的（玩家没勾填充模块）时，改从预设其余条目里抽出人称/语气/语言要求作为补充要求。
  const styleSegmentsText = collectFilledStyleSegments(segments, styleSegmentsFilled);
  const styleDirectives = collectStyleDirectiveLines(deliveredTexts.map((slot) => ({ name: slot.name, text: slot.content })));

  // 5. 明确要求可见思维链的预设
  const cotRequested = detectCotRequest(macroCtx.local, deliveredTexts.map((slot) => slot.content));

  // 6. 已关闭的文风候选（玩家在设置里能一键打开）
  const disabledStyleCandidates = collectDisabledStyleCandidates(preset, characterId);

  return {
    presetId,
    presetName,
    wordCountTarget: word?.value ?? null,
    wordCountRaw: word?.raw ?? '',
    wordCountSource: word?.source ?? '',
    shell,
    styleText: styleSegmentsText,
    styleDirectives,
    filledSegments,
    emptySegments,
    styleSegmentsFilled,
    styleSegmentsEmpty,
    disabledStyleCandidates,
    cotRequested,
    assistantPrefill: typeof preset.assistantPrefill === 'string' ? preset.assistantPrefill.trim() : '',
  };
}

interface NamedText { name: string; text: string }

/**
 * 括号段收集。
 *
 * 关键判据（真实预设验证过）：预设的「开始/结束」括号条目是**纯标签条目**
 * （正文就是 `<文风>` / `</故事基调>\n<文风>` 这种），而正文里出现的标签只是**提及**
 * （例如「确保<content>中正文字数达到至少3000字」）。若把提及也当成分隔符，
 * 栈会永远无法闭合，所有段都会变成「有内容」—— 那样「文风段其实是空的」就检测不出来了。
 * 因此只有纯标签条目参与括号配对。
 */
export function collectBracketSegments(items: readonly NamedText[]): Map<string, string> {
  const open = new Map<string, string>();
  const stack: string[] = [];
  for (const item of items) {
    const text = item.text ?? '';
    if (!text) continue;
    if (!PURE_TAG_MODULE_RE.test(text)) {
      appendToOpenSegments(open, stack, text);
      continue;
    }
    const tags = [...text.matchAll(/<(\/?)([A-Za-z_\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)(?:\s[^>]*)?\/?>/gu)];
    let cursor = 0;
    for (const tag of tags) {
      const isClose = tag[1] === '/';
      const name = tag[2]!;
      const index = tag.index ?? 0;
      appendToOpenSegments(open, stack, text.slice(cursor, index));
      if (isClose || tag[0]!.endsWith('/>')) {
        const at = stack.lastIndexOf(name);
        if (at >= 0) stack.splice(at, 1);
        // 先登记再关闭：即使段内一个字都没有，也要留下「这段是空的」的证据。
        if (!isClose && !open.has(name)) open.set(name, '');
      } else {
        stack.push(name);
        if (!open.has(name)) open.set(name, '');
      }
      cursor = index + tag[0]!.length;
    }
    appendToOpenSegments(open, stack, text.slice(cursor));
  }
  return open;
}

/** 整个模块正文只由标签组成（可含空白）—— 预设的「开始/结束」括号条目。 */
const PURE_TAG_MODULE_RE = /^(?:\s*<\/?[A-Za-z_\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*(?:\s[^>]*)?\/?>\s*)+$/u;

function appendToOpenSegments(open: Map<string, string>, stack: readonly string[], text: string): void {
  if (!text || stack.length === 0) return;
  for (const name of stack) {
    open.set(name, `${open.get(name) ?? ''}${text}`);
  }
}

// ── 字数 ─────────────────────────────────────────────────────────
const WORD_PATTERNS: RegExp[] = [
  /(?:不少于|不低于|至少|达到|需|要)\s*[`「『"']?\s*(\d{2,5})\s*[`」』"']?\s*字/gu,
  /(\d{2,5})\s*字(?:以上|起步|起|左右|\+)/gu,
  /(?:正文字数|字数下限|字数要求)[^0-9\n]{0,12}(\d{2,5})/gu,
];

interface WordRequirement { value: number; raw: string; source: string }

function extractWordRequirement(vars: Record<string, string>, texts: readonly NamedText[]): WordRequirement | null {
  const candidates: WordRequirement[] = [];
  const consider = (value: number, raw: string, source: string) => {
    if (!Number.isFinite(value) || value < MIN_WORD_TARGET || value > MAX_WORD_TARGET) return;
    candidates.push({ value: Math.trunc(value), raw: raw.trim(), source });
  };

  for (const [key, value] of Object.entries(vars)) {
    if (!/(?:字数|篇幅|长度)/u.test(key)) continue;
    const match = /(\d{2,5})/u.exec(value ?? '');
    if (match) consider(Number(match[1]), value.trim() || key, `变量 ${key}`);
  }

  for (const item of texts) {
    for (const pattern of WORD_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(item.text)) !== null) {
        const raw = item.text.slice(Math.max(0, (match.index ?? 0) - 12), (match.index ?? 0) + match[0].length + 4)
          .replace(/\s+/gu, ' ');
        consider(Number(match[1]), raw, `条目 ${item.name}`);
      }
    }
  }

  if (candidates.length === 0) return null;
  return candidates.reduce((best, item) => (item.value > best.value ? item : best));
}

// ── 输出外壳 ─────────────────────────────────────────────────────
const SHELL_VAR_RULES: Array<{ test: RegExp; kind: PresetShellKind }> = [
  { test: /正文|content/iu, kind: 'body' },
  { test: /摘要|总结|meow|FM/u, kind: 'summary' },
  { test: /cot|思维|thinking|分析头/iu, kind: 'thinking' },
  { test: /表|char_date|状态栏/iu, kind: 'table' },
  { test: /自定义标签|面板/u, kind: 'panel' },
];

function extractShellSegments(vars: Record<string, string>, texts: readonly string[]): PresetShellSegment[] {
  const found = new Map<string, PresetShellSegment>();
  const push = (tag: string, kind: PresetShellKind, source: string) => {
    const key = `${tag}::${kind}`;
    if (!found.has(key)) found.set(key, { tag, kind, source });
  };

  for (const [key, value] of Object.entries(vars)) {
    if (!value) continue;
    const rule = SHELL_VAR_RULES.find((item) => item.test.test(key));
    if (!rule) continue;
    const tagMatch = /<([A-Za-z_][\w.-]*)/u.exec(value);
    const tag = tagMatch?.[1];
    if (tag) push(tag, rule.kind, key);
  }

  // 正文里直接出现的已知标签（预设可能只在正文要求里提到，而没有做变量）
  const known: Array<{ tag: string; kind: PresetShellKind }> = [
    { tag: 'thinking', kind: 'thinking' },
    { tag: 'content', kind: 'body' },
    { tag: 'meow_FM', kind: 'summary' },
    { tag: 'char_date', kind: 'table' },
  ];
  for (const text of texts) {
    for (const item of known) {
      if (new RegExp(`</?${item.tag}[\\s>]`, 'u').test(text)) push(item.tag, item.kind, '正文');
    }
  }
  return [...found.values()];
}

// ── 文风 ─────────────────────────────────────────────────────────
const STYLE_SEGMENT_RE = /文风|风格|基调|行文/u;
const STYLE_LINE_MATCH = /文风|行文|文笔|人称|叙事视角|语气|语言风格|节奏|描写/u;

/** 非空表现段（`<文风>`/`<故事基调>`）里的正文 —— 这才是「预设提供的文风」。 */
function collectFilledStyleSegments(segments: Map<string, string>, styleSegmentsFilled: readonly string[]): string {
  const blocks: string[] = [];
  for (const name of styleSegmentsFilled) {
    const text = (segments.get(name) ?? '').trim();
    if (text) blocks.push(text);
  }
  return blocks.join('\n\n').slice(0, MAX_STYLE_CHARS).trim();
}

/** 表现段为空时的补充要求：预设其余条目里写死的人称/语气/语言/节奏要求。 */
function collectStyleDirectiveLines(texts: readonly NamedText[]): string {
  const blocks: string[] = [];
  for (const item of texts) {
    if (PURE_TAG_MODULE_RE.test(item.text)) continue;
    const lines: string[] = [];
    for (const rawLine of item.text.split(/\r?\n/u)) {
      const line = rawLine.trim().replace(/^[-*•]\s*/u, '').trim();
      if (!line || line.length > 160) continue;
      if (!STYLE_LINE_MATCH.test(line)) continue;
      if (/^<\/?[A-Za-z_\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*\/?>$/u.test(line)) continue;
      if (!lines.includes(line)) lines.push(line);
    }
    if (lines.length) blocks.push(`【${item.name}】\n${lines.slice(0, 6).join('\n')}`);
  }
  return blocks.slice(0, 12).join('\n\n').slice(0, MAX_STYLE_CHARS).trim();
}

function detectCotRequest(vars: Record<string, string>, texts: readonly string[]): boolean {
  for (const [key, value] of Object.entries(vars)) {
    if (!value) continue;
    if (/(?:cot|思维|thinking)/iu.test(key)) return true;
  }
  return texts.some((text) => /<!--\s*Start the ECoT|<\s*thinking|ECoT/iu.test(text));
}

function collectDisabledStyleCandidates(preset: STPreset, characterId: number | null): string[] {
  const orders = Array.isArray(preset.prompt_order) ? preset.prompt_order : [];
  const order =
    (characterId !== null ? orders.find((item) => item.character_id === characterId) ?? null : null)
    ?? orders.find((item) => item.character_id === 100001)
    ?? orders[0]
    ?? null;
  if (!order || !Array.isArray(order.order)) return [];
  const promptMap = new Map<string, STPresetPrompt>(
    preset.prompts.map((item) => [item.identifier, item] as const),
  );
  const names: string[] = [];
  for (const slot of order.order) {
    if (!slot || slot.enabled !== false) continue;
    const prompt = promptMap.get(slot.identifier);
    const name = prompt?.name?.trim() || slot.identifier;
    if (STYLE_SEGMENT_RE.test(name) && (prompt?.content ?? '').trim()) names.push(name);
  }
  return rankStyleCandidates(names).slice(0, 8);
}

// ── 面向模型的执行卡 ─────────────────────────────────────────────
const SHELL_TARGET_TEXT: Record<PresetShellKind, string> = {
  body: 'body 里 kind:"narration"/"dialogue" 的块（台词带 speaker）',
  thinking: 'body 里 kind:"system" 的块（预设要求的可见思维链/自言自语必须原样写出）',
  summary: 'continuation.summary 字段',
  table: 'body 里 kind:"system" 的块（表格用纯文本行表示）',
  panel: 'body 里 kind:"system" 的块',
};

export function buildPresetShellMappingLines(presentation: PresetPresentation): string[] {
  return presentation.shell.map((segment) => `  <${segment.tag}> → ${SHELL_TARGET_TEXT[segment.kind]}`);
}

/** 生成点执行卡：最后一条 user 消息的正文（覆盖上文所有默认创作偏好）。 */
export function buildPresetPresentationCard(presentation: PresetPresentation): string {
  const lines: string[] = [
    '# 已激活酒馆预设·表现层执行卡（最后一条指令，优先于上文所有内置默认值）',
    `预设：《${presentation.presetName}》`,
  ];

  if (presentation.wordCountTarget) {
    const target = presentation.wordCountTarget;
    const perBlock = Math.max(200, Math.round(target / 7 / 50) * 50);
    lines.push(
      `【字数】本回合可见正文合计不少于 ${target} 字（${presentation.wordCountSource || '预设要求'}：${presentation.wordCountRaw || `${target}字`}）。`,
      `  - 只统计 body 中 narration/dialogue 块的 text（不含 choices、factCandidates、continuation、字段名与 JSON 符号）。`,
      `  - 建议 ${Math.max(4, Math.round(target / 600))}-${Math.max(6, Math.round(target / 400))} 个块，每块约 ${perBlock} 字；写完先自查总字数，不足就继续把场景写下去。`,
      '  - 禁止用重复句、堆砌形容词、空泛总结或复制上文来凑字数。',
      '  - 上文《NarrativeTurn JSON 回复格式》里的字数是**无预设时的默认值**，本回合以预设要求为准。',
    );
  }

  if (presentation.styleText) {
    lines.push('【文风】以下文本是预设自己写的文风/基调要求原文，逐条照做（它优先于应用内置《文风参考·日记体见闻录》）：');
    lines.push(presentation.styleText);
  } else {
    lines.push(
      `【文风】预设本次没有文风正文：它的〈${presentation.styleSegmentsEmpty.join('〉〈') || '文风'}〉包装是空的，说明填充模块没有勾选。本回合先由应用内置文风兜底，但不要把它当成预设文风。`,
    );
    if (presentation.disabledStyleCandidates.length) {
      lines.push(`  - 玩家可在预设条目列表里勾选其中一个来启用预设文风：${presentation.disabledStyleCandidates.join('、')}`);
    }
  }
  if (presentation.styleDirectives) {
    lines.push('【预设其余条目里的表现要求】以下要求同样来自预设，必须照做：');
    lines.push(presentation.styleDirectives);
  }

  if (presentation.shell.length) {
    lines.push('【输出外壳映射】预设的标签外壳按下面映射写，标签本身不要出现在 JSON 之外：');
    lines.push(...buildPresetShellMappingLines(presentation));
  }
  if (presentation.cotRequested) {
    lines.push(
      '【思维链】预设要求先做思考/分析再写正文。思考段照预设写（保留预设要求的语言、人称与人格口吻），但**不要**写进故事段落：',
      '  - 应用会把 `<thinking>`/`<思考>`/ECoT 注释这类思维链从可见正文里摘出来单独存放，等同于「只在后台过一遍」；',
      '  - 因此正文块（narration/dialogue）里**禁止**出现 `<thinking>`、`<!-- Start the ECoT -->`、mermaid 流程图、`# 开始大思考` 这类幕后分析；',
      '  - 若你仍要按预设输出思维链，请把它放进 body 中 kind:"system" 的块（应用会识别并摘除），正文只留故事本身。',
    );
  }

  // 台词归属（2026-10-03 用户实测：砂糖的呻吟被套进了玩家名牌+头像的对话框里）。
  // 玩家只会说玩家本回合输入过的原话，其余台词一律必须有真实发言者。
  lines.push(
    [
      '【台词归属】',
      '  - 每一句台词都要有归属：写成 body 中 kind:"dialogue" 的块，并填 speaker（真实发言者姓名）。',
      '  - **不要**在 narration 块里用引号写台词 —— 没有 speaker 的引号句属于归属不明。',
      '  - 玩家的名字只能挂在玩家本回合**明确输入过的原话**上；拟声词、喘息、呻吟、痛呼、环境音以及 NPC 的调笑，绝不挂玩家名。',
    ].join('\n'),
  );

  lines.push(
    '【不可协商】上面所有内容都必须装进一个完整合法的 NarrativeTurn JSON（body / choices / factCandidates / continuation 四个根字段齐全），JSON 之外不得有任何文字、标签或围栏；本回合的 `<变量事实>` 块照旧输出。',
  );
  return lines.join('\n');
}

/** system prompt 顶部的优先级声明（替换 mainPromptAssembly 里的通用措辞）。 */
export function buildPresetPrecedenceHeader(presentation: PresetPresentation): string {
  const facts: string[] = [];
  if (presentation.wordCountTarget) {
    facts.push(`- 正文字数下限 = ${presentation.wordCountTarget} 字（预设要求；应用内置的字数占位符已同步为该值）。`);
  }
  if (presentation.styleText) {
    facts.push('- 文风/人称/语气以预设自己的文风条目为准，应用内置文风模块本回合不作为依据。');
  } else {
    facts.push(
      `- 预设本次没有文风正文（〈${presentation.styleSegmentsEmpty.join('〉〈') || '文风'}〉段是空的，未勾选的填充模块：${presentation.disabledStyleCandidates.join('、') || '无'}）：本回合由应用内置文风兜底，玩家勾选填充模块后立即切换为预设文风。`,
    );
  }
  if (presentation.styleDirectives) {
    facts.push('- 预设其余条目写死了人称/语言/语气要求，执行卡里已原文附上，按它写。');
  }
  if (presentation.cotRequested) {
    facts.push('- 预设要求先思考再写正文：思维链请在 body 的 kind:"system" 块里写；应用会把它识别为思维链并从可见正文中摘除（正文只留故事）。');
  }
  if (presentation.shell.length) {
    facts.push(`- 预设外壳标签：${presentation.shell.map((s) => `<${s.tag}>`).join(' ')} → 按执行卡映射到 JSON 字段。`);
  }
  return [
    `# 酒馆预设优先（本回合已激活：${presentation.presetName}）`,
    '已启用玩家导入的酒馆预设作为**表现层权威**：文风、人称、叙事语气、人格演绎、输出标签、节奏与篇幅一律以该预设为准。',
    '本应用只保留两条机器契约，无论预设怎么写都必须同时满足：',
    '1) 正文必须按本应用要求的**载体格式**输出（结构化字段/行动选项），否则无法解析并会判定为失败回复；',
    '2) 本回合的 `<变量事实>` 块必须输出（数值结算依赖它）。',
    ...facts,
    '除这两条之外，任何冲突**一律以预设为准**；严禁用应用内置的文风/思维链/格式写法去覆盖预设的人设与输出要求。',
  ].join('\n');
}

// ── 面向玩家的诊断 ───────────────────────────────────────────────
export function formatPresetPresentationSummary(presentation: PresetPresentation): string {
  const stylePart = presentation.styleText
    ? `文风：预设〈${presentation.styleSegmentsFilled.join('〉〈') || '文风'}〉段已启用`
    : `文风：预设〈${presentation.styleSegmentsEmpty.join('〉〈') || '文风'}〉段是空的`;
  const parts = [
    presentation.wordCountTarget ? `字数下限 ${presentation.wordCountTarget} 字` : '字数：预设未声明',
    stylePart,
    presentation.shell.length ? `外壳 ${presentation.shell.map((s) => `<${s.tag}>`).join('')}` : '外壳：无',
  ];
  if (presentation.cotRequested) parts.push('要求先思考（思维链不进正文）');
  if (!presentation.styleText && presentation.disabledStyleCandidates.length) {
    parts.push(`可勾选：${presentation.disabledStyleCandidates.slice(0, 3).join('、')}`);
  }
  return parts.join(' · ');
}

/** 预设「文风段是空的」时需要玩家动手的候选条目（名字里带「文风」的排前面）。 */
export function rankStyleCandidates(names: readonly string[]): string[] {
  const styleFirst = names.filter((name) => /文风/u.test(name));
  const rest = names.filter((name) => !/文风/u.test(name));
  return [...styleFirst, ...rest];
}

/** 预设要求「可见思维链」时，内置格式守卫里的这条禁令必须改写（它会把预设标志性输出整体压掉）。 */
export const BUILTIN_FORMAT_COT_BAN = '禁止输出 thinking、analysis、推理过程或隐藏状态。';
export const PRESET_FORMAT_COT_ALLOWANCE =
  'JSON 之外禁止出现任何文字、Markdown 围栏或 XML 标签；若已激活预设要求先思考再写正文，可以在 body 中输出 kind:"system" 的思维链块（保留预设要求的语言与口吻），应用会把它识别为思维链并从可见正文中摘除；narration/dialogue 块里不得出现 thinking/ECoT/mermaid 等幕后分析。';

/**
 * 修正内置格式守卫文本：字数换成生效值，并在预设要求可见思维链时改写那条禁令。
 * 只在确实匹配到已知句子时替换，避免破坏玩家自定义过的模块。
 */
export function rewordBuiltinFormatModule(
  content: string,
  presentation: PresetPresentation | null,
  wordTarget: number,
): string {
  let next = content.replace(/\{wordCountTarget\}/gu, String(wordTarget));
  if (presentation && presentation.cotRequested && next.includes(BUILTIN_FORMAT_COT_BAN)) {
    next = next.replace(BUILTIN_FORMAT_COT_BAN, PRESET_FORMAT_COT_ALLOWANCE);
  }
  if (presentation?.wordCountTarget && !content.includes('{wordCountTarget}')) {
    next = `${next}\n\n本回合正文合计不少于 ${presentation.wordCountTarget} 字（来源：已激活预设《${presentation.presetName}》）。`;
  }
  return next;
}
