import type { STPreset, STRegexScript } from '@/models/stTypes';

export type TavernRegexScriptKind = 'prompt_preprocess' | 'output_postprocess' | 'display_replace' | 'blocked';

export interface TavernRegexScriptSafety {
  kind: TavernRegexScriptKind;
  disabled: boolean;
  risky: boolean;
  blocksProtocolTags: boolean;
  reason: string;
}

export interface TavernRegexDryRunResult {
  ok: boolean;
  safety: TavernRegexScriptSafety;
  matches: number;
  before: string;
  after: string;
  warnings: string[];
  error?: string;
}

export interface TavernRegexApplyResult {
  text: string;
  applied: string[];
  skipped: string[];
  matches?: number;
}

const PROJECT_PROTOCOL_TAG_NAMES = [
  'thinking',
  'think',
  '思考',
  '正文',
  'body',
  'content',
  'text',
  '内容',
  '短期记忆',
  'memory',
  'summary',
  'recap',
  '记忆',
  '回忆',
  '命令',
  'command',
  'commands',
  'cmd',
  '动态世界',
  'world',
  'worldevent',
  '世界',
  '事件',
  '行动选项',
  'actions',
  'options',
  'choice',
  'choices',
  '选项',
  '变量草稿',
  'variableDraft',
  '变量候选',
  '变量线索',
  '变量摘要',
  '变量更新',
  '天气',
  '剧情规划',
  'storyPlan',
  'storyPlanning',
  '剧情计划',
  '剧情安排',
  '后续规划',
  '触发狭间',
  '狭间问答',
  '狭间评判',
];

const PROJECT_PROTOCOL_TAG_GROUP = PROJECT_PROTOCOL_TAG_NAMES
  .map((tag) => tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'))
  .join('|');
const PROTOCOL_TAG_RE = new RegExp(`<\\s*(?:${PROJECT_PROTOCOL_TAG_GROUP})\\s*>|<\\/\\s*(?:${PROJECT_PROTOCOL_TAG_GROUP})\\s*>`, 'i');
const SAFE_OUTPUT_CLEANUP_FIND_RE = /<!--|<\s*\/?\s*math\b|<\s*Q\b|<\s*\/\s*WF\b|\^\[[^\]]*(?:\\t|\\\\t|\s)[^\]]*\]\+|\^\\s\+/i;
const UNSAFE_REPLACEMENT_RE = /<\s*(?:style|script|details|summary|div|span|textarea|iframe|object|embed)\b|<\/\s*(?:style|script|details|summary|div|span|textarea|iframe|object|embed)\s*>/i;

function readScriptName(script: STRegexScript): string {
  return String(script.script_name ?? script.scriptName ?? script.name ?? script.id ?? '');
}

function readFindRegex(script: STRegexScript): string {
  return String(script.find_regex ?? script.findRegex ?? script.find ?? '');
}

function readReplaceString(script: STRegexScript): string {
  return String(script.replace_string ?? script.replaceString ?? script.replace ?? '');
}

export function normalizeTavernRegexScripts(raw: unknown): STRegexScript[] {
  if (isRegexScriptLike(raw)) return [raw];
  if (Array.isArray(raw)) {
    return raw.filter((item): item is STRegexScript => isRegexScriptLike(item));
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([id, item]) => {
        if (!item || typeof item !== 'object') return null;
        const script = item as STRegexScript;
        return script.id ? script : { ...script, id };
      })
      .filter((item): item is STRegexScript => item !== null && isRegexScriptLike(item));
  }
  return [];
}

/** Standalone exports are bound to one preset; existing edits/disabled states win. */
export function mergeTavernRegexImport(preset: STPreset, jsonText: string): { preset: STPreset; added: number; duplicates: number } {
  const raw: unknown = JSON.parse(jsonText);
  const imported = Array.isArray(raw) || isRegexScriptLike(raw)
    ? normalizeTavernRegexScripts(raw) : extractTavernRegexScripts(raw);
  if (!imported.length) throw new Error('没有找到有效正则规则，请选择正则 JSON（数组、单条规则或 regex_scripts）。');
  const existing = extractTavernRegexScripts(preset);
  const merged = dedupeRegexScripts([...existing, ...imported]);
  return { preset: { ...preset, regex_scripts: merged }, added: merged.length - existing.length, duplicates: imported.length - (merged.length - existing.length) };
}

export interface TavernRegexScope {
  destination: 'prompt' | 'display';
  /** ST text sources: 1=user, 2=assistant, 5=world info. */
  placement: number;
  /** Last conversational message is depth 0; system/utility prompts have no depth. */
  depth?: number;
  edited?: boolean;
  resolveMacros?: (text: string) => string;
}

/** Conservative parser: propagate risky children through wrapper groups. Not a regex sandbox. */
function hasComplexGroupRepetition(source: string): boolean {
  const groups: boolean[] = [false];
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '\\') { i += 1; continue; }
    if (char === '[') { inClass = true; continue; }
    if (char === ']' && inClass) { inClass = false; continue; }
    if (inClass) continue;
    if (char === '(') { groups.push(false); continue; }
    if (char === ')' && groups.length > 1) {
      const risky = groups.pop()!;
      const next = source[i + 1];
      if (risky && (next === '+' || next === '*' || next === '{')) return true;
      groups[groups.length - 1] ||= risky;
      continue;
    }
    if (char === '+' || char === '*' || char === '{' || char === '|' || (char === '?' && source[i - 1] !== '(')) groups[groups.length - 1] = true;
  }
  return false;
}

function scopedRegexProblem(script: STRegexScript): string | null {
  const source = readFindRegex(script);
  const replacement = readReplaceString(script);
  if (/<\/?[a-z][^>]*>/i.test(replacement) || UNSAFE_REPLACEMENT_RE.test(replacement)) return 'HTML/CSS/脚本美化不执行；请使用游戏原生显示';
  if (source.length > 10000 || hasComplexGroupRepetition(source)) return '复杂重复正则已阻止，避免阻塞页面';
  return null;
}

/** Plain-text scoped copies only. Never run these on a raw response JSON/protocol. */
export function applyTavernScopedRegexScripts(rawText: string, rawPreset: unknown, scope: TavernRegexScope): TavernRegexApplyResult {
  let text = rawText;
  const applied: string[] = [];
  const skipped: string[] = [];
  let matches = 0;
  for (const script of extractTavernRegexScripts(rawPreset)) {
    const name = readScriptName(script) || 'regex_script';
    if (isScriptDisabled(script)) continue;
    if (!Array.isArray(script.placement) || !script.placement.includes(scope.placement)) continue;
    const display = script.markdownOnly === true;
    const prompt = script.promptOnly === true;
    if ((scope.destination === 'prompt' && display && !prompt) || (scope.destination === 'display' && prompt && !display)) continue;
    if (scope.edited && script.runOnEdit !== true) continue;
    if (scope.depth !== undefined) {
      if (typeof script.minDepth === 'number' && script.minDepth >= 0 && scope.depth < script.minDepth) continue;
      if (typeof script.maxDepth === 'number' && script.maxDepth >= 0 && scope.depth > script.maxDepth) continue;
    }
    const problem = scopedRegexProblem(script);
    if (problem || text.length > 200000) { skipped.push(`${name}: ${problem ?? '文本过长，已跳过正则'}`); continue; }
    try {
      let source = readFindRegex(script);
      if (script.substituteRegex && scope.resolveMacros) {
        source = source.replace(/\{\{[^{}]+\}\}/g, macro => {
          const resolved = scope.resolveMacros!(macro);
          return script.substituteRegex === 2 ? resolved.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : resolved;
        });
      }
      if (source.length > 10000 || hasComplexGroupRepetition(source)) { skipped.push(`${name}: 复杂重复正则已阻止，避免阻塞页面`); continue; }
      const { pattern, flags } = parseRegexSourceAndFlags(source, String(script.flags ?? ''));
      const regex = new RegExp(pattern, flags);
      const replacement = readReplaceString(script);
      if (/\{\{(?!match\}\})/.test(replacement) && !scope.resolveMacros) { skipped.push(`${name}: 缺少宏上下文`); continue; }
      // Expand only the authored template. Captured message text is data, not macro code.
      const template = scope.resolveMacros ? replacement.replace(/\{\{[^{}]+\}\}/g, macro => macro === '{{match}}' ? macro : scope.resolveMacros!(macro)) : replacement;
      const after = text.replace(regex, (...args: unknown[]) => {
        matches += 1;
        const named = typeof args.at(-1) === 'object' ? args.at(-1) as Record<string, string> : undefined;
        const offsetAt = args.length - (named ? 3 : 2);
        const trim = (value: unknown) => (script.trim_strings ?? script.trimStrings ?? []).reduce((s, token) => token ? s.split(token).join('') : s, String(value ?? ''));
        return template.replace(/\{\{match\}\}|\$(\$|&|\d{1,2}|<[^>]+>)/g, (literal, key: string | undefined) => {
          if (literal === '{{match}}') return trim(args[0]);
          if (key === undefined) return literal;
          if (key === '$') return '$';
          if (key === '&') return trim(args[0]);
          if (key.startsWith('<')) return trim(named?.[key.slice(1, -1)]);
          const index = Number(key);
          return index > 0 && index < offsetAt ? trim(args[index]) : literal;
        });
      });
      if (after !== text) { applied.push(name); text = after; }
    } catch (error) { skipped.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { text, applied, skipped, matches };
}

export function extractTavernRegexScripts(rawPreset: unknown): STRegexScript[] {
  if (!rawPreset || typeof rawPreset !== 'object') return [];
  const preset = rawPreset as Record<string, unknown>;
  const candidates: unknown[] = [];

  const pushPath = (...path: string[]) => {
    const value = readNestedValue(preset, path);
    if (value !== undefined) candidates.push(value);
  };

  // SillyTavern official regex extension stores preset scripts through
  // readPresetExtensionField({ path: 'regex_scripts' }); community exports may
  // preserve that field either at top level or under extension containers.
  pushPath('regex_scripts');
  pushPath('regexScripts');
  pushPath('extensions', 'regex_scripts');
  pushPath('extensions', 'regexScripts');
  pushPath('extensions', 'RegexBinding', 'regexes');
  pushPath('extensions', 'RegexBinding', 'regex_scripts');
  pushPath('extensions', 'RegexBinding', 'scripts');
  pushPath('extensions', 'SPreset', 'RegexBinding', 'regexes');
  pushPath('extensions', 'SPreset', 'RegexBinding', 'regex_scripts');
  pushPath('extensions', 'SPreset', 'RegexBinding', 'scripts');
  pushPath('extensions', 'SPreset', 'regex_scripts');
  pushPath('extensions', 'SPreset', 'regexScripts');
  pushPath('tavern_helper', 'scripts');
  pushPath('extensions', 'tavern_helper', 'scripts');

  return dedupeRegexScripts(candidates.flatMap(normalizeTavernRegexScripts));
}

function readNestedValue(source: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function isRegexScriptLike(raw: unknown): raw is STRegexScript {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const script = raw as STRegexScript;
  const find = script.find_regex ?? script.findRegex ?? script.find;
  return typeof find === 'string' && find.trim().length > 0;
}

function dedupeRegexScripts(scripts: STRegexScript[]): STRegexScript[] {
  const seen = new Set<string>();
  const result: STRegexScript[] = [];
  scripts.forEach((script, index) => {
    const key = [
      readFindRegex(script),
      readReplaceString(script),
      JSON.stringify([...new Set(Array.isArray(script.placement) ? script.placement.filter((value): value is number => typeof value === 'number') : [])].sort((a, b) => a - b)),
      JSON.stringify(script.trim_strings ?? script.trimStrings ?? []),
      String(script.markdownOnly ?? false), String(script.promptOnly ?? false),
      String(script.minDepth ?? -1), String(script.maxDepth ?? -1),
      String(script.substituteRegex ?? 0), String(script.runOnEdit ?? false),
      String(script.flags ?? ''),
    ].join('\u0000') || `index_${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(script);
  });
  return result;
}

export function analyzeTavernRegexScript(script: STRegexScript): TavernRegexScriptSafety {
  const disabled = isScriptDisabled(script);
  const combined = [
    script.id,
    readScriptName(script),
    readFindRegex(script),
    readReplaceString(script),
    JSON.stringify(script.placement ?? ''),
  ].map((item) => String(item ?? '')).join('\n');
  const blocksProtocolTags = PROTOCOL_TAG_RE.test(combined);
  const displayLike = /display|html|css|dom|style|界面|显示|渲染|全局/i.test(combined);
  const outputLike = /output|response|reply|assistant|post/i.test(combined);
  const promptLike = /prompt|input|request|system|user/i.test(combined);
  const safeCleanupLike = isSafeOutputCleanupCandidate(script);

  if (Array.isArray(script.placement) && script.placement.length > 0) {
    const problem = scopedRegexProblem(script);
    return { kind: problem ? 'display_replace' : script.promptOnly ? 'prompt_preprocess' : 'display_replace', disabled, risky: Boolean(problem), blocksProtocolTags,
      reason: problem ?? '纯文本规则：按输入/回复/世界书来源、发送/显示范围和消息深度处理副本；不改存档或回复 JSON' };
  }

  if (safeCleanupLike) {
    return {
      kind: 'output_postprocess',
      disabled,
      risky: false,
      blocksProtocolTags,
      reason: '安全输出清理脚本：仅允许删除注释、抗截断/抗空回占位或缩进噪声',
    };
  }

  if (displayLike) {
    return {
      kind: 'display_replace',
      disabled,
      risky: true,
      blocksProtocolTags,
      reason: '显示层/CSS/DOM/全局替换类脚本默认不执行',
    };
  }

  if (blocksProtocolTags) {
    return {
      kind: 'blocked',
      disabled,
      risky: true,
      blocksProtocolTags,
      reason: '可能改写项目协议标签，默认阻止执行',
    };
  }

  if (outputLike) {
    return {
      kind: 'output_postprocess',
      disabled,
      risky: false,
      blocksProtocolTags,
      reason: '输出后处理脚本仅允许未来显式开启后作用于临时文本',
    };
  }

  if (promptLike) {
    return {
      kind: 'prompt_preprocess',
      disabled,
      risky: false,
      blocksProtocolTags,
      reason: '提示词预处理脚本仅允许未来显式开启后作用于预设文本副本',
    };
  }

  return {
    kind: 'blocked',
    disabled,
    risky: true,
    blocksProtocolTags,
    reason: '无法确认作用域的正则脚本默认不执行',
  };
}

export function applyTavernOutputRegexScripts(rawText: string, rawPreset: unknown): TavernRegexApplyResult {
  let text = String(rawText ?? '');
  const scripts = extractTavernRegexScripts(rawPreset);
  const applied: string[] = [];
  const skipped: string[] = [];

  // Legacy tag-text cleanup is diagnostic-only. Structured responses must stay byte-identical.
  if (/^\s*(?:[\[{]|```(?:json)?\s*[\[{])/i.test(text)) {
    return { text, applied, skipped: scripts.map(script => `${readScriptName(script) || 'regex_script'}: 不处理原始回复 JSON`) };
  }

  for (const script of scripts) {
    const name = readScriptName(script) || String(script.id ?? 'regex_script');
    const safety = analyzeTavernRegexScript(script);
    if (safety.disabled) {
      skipped.push(`${name}: disabled`);
      continue;
    }
    if (scopedRegexProblem(script) || !isSafeOutputCleanupCandidate(script) || safety.kind !== 'output_postprocess' || safety.risky) {
      skipped.push(`${name}: ${safety.reason}`);
      continue;
    }

    try {
      const source = readFindRegex(script);
      const replace = readReplaceString(script);
      if (!source.trim()) {
        skipped.push(`${name}: empty find_regex`);
        continue;
      }
      if (UNSAFE_REPLACEMENT_RE.test(replace)) {
        skipped.push(`${name}: unsafe replacement markup`);
        continue;
      }
      const { pattern, flags } = parseRegexSourceAndFlags(source, readRegexFlags(script));
      const regex = new RegExp(pattern, flags);
      const before = text;
      const after = text.replace(regex, (...args) =>
        replace.replace(/\$(\d+)/g, (_m, index) => String(args[Number(index)] ?? '')),
      );
      if (after === before) continue;
      if (wouldRemoveProtocolTags(before, after)) {
        skipped.push(`${name}: would remove project protocol tags`);
        continue;
      }
      text = after;
      applied.push(name);
    } catch (error) {
      skipped.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { text, applied, skipped };
}

function isSafeOutputCleanupCandidate(script: STRegexScript): boolean {
  const find = readFindRegex(script);
  const replace = readReplaceString(script);
  if (UNSAFE_REPLACEMENT_RE.test(replace)) return false;
  if (PROTOCOL_TAG_RE.test(`${find}\n${replace}`)) return false;
  return SAFE_OUTPUT_CLEANUP_FIND_RE.test(find);
}

export function dryRunTavernRegexScript(script: STRegexScript, sampleText: string, scope?: TavernRegexScope): TavernRegexDryRunResult {
  const safety = analyzeTavernRegexScript(script);
  const problem = scopedRegexProblem(script);
  if (problem) return { ok: false, safety: { ...safety, risky: true, reason: problem }, matches: 0, before: sampleText, after: sampleText, warnings: [problem] };
  if (Array.isArray(script.placement) && script.placement.length) {
    const result = applyTavernScopedRegexScripts(sampleText, { regex_scripts: [script] }, scope ?? { destination: script.promptOnly ? 'prompt' : 'display', depth: 0, placement: Number(script.placement[0]) });
    return { ok: !safety.risky && result.skipped.length === 0, safety, matches: result.matches ?? 0, before: sampleText, after: result.text, warnings: result.skipped };
  }
  const warnings: string[] = [];
  const before = String(sampleText ?? '');
  if (safety.kind === 'blocked' || safety.kind === 'display_replace') {
    warnings.push(safety.reason);
  }
  if (safety.blocksProtocolTags) {
    warnings.push('检测到项目协议标签风险：正文/短期记忆/动态世界/行动选项/变量草稿/变量更新/天气/剧情规划。');
  }

  try {
    const source = readFindRegex(script);
    if (!source.trim()) {
      return { ok: false, safety, matches: 0, before, after: before, warnings, error: 'find_regex 为空' };
    }

    const { pattern, flags } = parseRegexSourceAndFlags(source, readRegexFlags(script));
    const regex = new RegExp(pattern, flags);
    let matches = 0;
    const after = before.replace(regex, (...args) => {
      matches += 1;
      const replace = readReplaceString(script);
      return replace.replace(/\$(\d+)/g, (_m, index) => String(args[Number(index)] ?? ''));
    });

    if (wouldRemoveProtocolTags(before, after)) {
      warnings.push('替换结果会删除或改写项目协议标签，真实运行时必须阻止。');
      return { ok: false, safety: { ...safety, risky: true, blocksProtocolTags: true }, matches, before, after, warnings };
    }

    return { ok: !safety.risky, safety, matches, before, after, warnings };
  } catch (error) {
    return {
      ok: false,
      safety,
      matches: 0,
      before,
      after: before,
      warnings,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isScriptDisabled(script: STRegexScript): boolean {
  const disabled = (script as { disabled?: unknown }).disabled;
  return disabled === true || disabled === 1 || disabled === 'true';
}

function readRegexFlags(script: STRegexScript): string {
  const raw = String((script as { flags?: unknown }).flags ?? '');
  const flags = new Set(['g']);
  for (const flag of raw) {
    if ('gimsuy'.includes(flag)) flags.add(flag);
  }
  return [...flags].join('');
}

function parseRegexSourceAndFlags(source: string, fallbackFlags: string): { pattern: string; flags: string } {
  const trimmed = source.trim();
  if (!trimmed.startsWith('/')) return { pattern: source, flags: fallbackFlags };
  let escaped = false;
  for (let i = trimmed.length - 1; i > 0; i -= 1) {
    const char = trimmed[i];
    if (char === '/' && !escaped) {
      const pattern = trimmed.slice(1, i);
      const suffix = trimmed.slice(i + 1);
      if (/^[gimsuy]*$/.test(suffix)) {
        const flags = new Set(fallbackFlags.split('').filter(Boolean));
        for (const flag of suffix) flags.add(flag);
        return { pattern, flags: [...flags].join('') };
      }
      return { pattern: source, flags: fallbackFlags };
    }
    escaped = char === '\\' ? !escaped : false;
  }
  return { pattern: source, flags: fallbackFlags };
}

function wouldRemoveProtocolTags(before: string, after: string): boolean {
  const beforeTags = before.match(new RegExp(PROTOCOL_TAG_RE.source, 'gi')) ?? [];
  if (beforeTags.length === 0) return false;
  const afterTags = after.match(new RegExp(PROTOCOL_TAG_RE.source, 'gi')) ?? [];
  return afterTags.length < beforeTags.length;
}
