import {
  FACT_CANDIDATE_DOMAINS,
  STORY_BLOCK_KINDS,
  type FactCandidate,
  type NarrativeTurn,
  type PlayerChoice,
  type StoryBlock,
} from '@/models/teyvat/narrativeTurn';
import { isRecord } from '@/utils/valueGuards';
import { filterNarrativeTurnShell } from '@/utils/presetShellFilter';

export type NarrativeTurnErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_ROOT'
  | 'INVALID_REQUIRED_FIELD';

export class NarrativeTurnParseError extends Error {
  readonly code: NarrativeTurnErrorCode;

  constructor(code: NarrativeTurnErrorCode) {
    super(code);
    this.name = 'NarrativeTurnParseError';
    this.code = code;
  }
}

const narrativeTurnNormalizationWarnings = new WeakMap<NarrativeTurn, string[]>();
/** 被外壳过滤器摘出的预设思维链：不进可见正文，但保留在消息诊断里备查。 */
const narrativeTurnPresetCot = new WeakMap<NarrativeTurn, string>();

export function getNarrativeTurnNormalizationWarnings(turn: NarrativeTurn): readonly string[] {
  return narrativeTurnNormalizationWarnings.get(turn) ?? [];
}

/** 本回合被摘出可见正文的预设思维链（没有则为空串）。 */
export function getNarrativeTurnPresetCot(turn: NarrativeTurn): string {
  return narrativeTurnPresetCot.get(turn) ?? '';
}

function requiredText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text || null;
}

function optionalText(value: unknown): string | undefined {
  return requiredText(value) ?? undefined;
}

function parseJsonWithOneFenceRepair(raw: string): unknown {
  const source = raw.trim();

  // 1. 直接解析（最常见路径）
  try {
    return JSON.parse(source);
  } catch {
    /* 继续修复 */
  }

  // 2. 任意位置的 ``` 围栏块（思考型模型常在 JSON 前后带推理文本），从最后一个围栏往前试
  const fenceMatches = [...source.matchAll(/```(?:json)?\s*\r?\n?([\s\S]*?)```/gi)];
  for (let i = fenceMatches.length - 1; i >= 0; i -= 1) {
    try {
      const fenced = fenceMatches[i]?.[1];
      if (fenced === undefined) continue;
      return JSON.parse(fenced.trim());
    } catch {
      /* 继续修复 */
    }
  }

  // 3. 顶层 JSON 跨度提取：按顺序扫描字符串感知的平衡跨度，
  //    只接受顶层候选（嵌套片段不返回），按长度降序尝试解析。
  const spans = extractTopLevelJsonSpans(source);
  spans.sort((a, b) => b.length - a.length);
  for (const span of spans) {
    try {
      return JSON.parse(span);
    } catch {
      /* 尝试下一个候选 */
    }
  }

  throw new NarrativeTurnParseError('INVALID_JSON');
}

/** 提取字符串中所有"顶层"JSON 跨度（{...} 或 [...]），要求括号/字符串配对平衡。 */
function extractTopLevelJsonSpans(source: string): string[] {
  const spans: string[] = [];
  const openers = '{[';
  const closers = '}]';
  const matching: Record<string, string> = { '{': '}', '[': ']' };

  let i = 0;
  while (i < source.length) {
    const opener = source[i];
    if (opener !== '{' && opener !== '[') {
      i += 1;
      continue;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let j = i; j < source.length; j += 1) {
      const ch = source[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === '{' || ch === '[') {
        depth += 1;
      } else if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) {
      // 从这个 opener 开始已经无法闭合：跳过它继续找下一个候选
      i += 1;
      continue;
    }
    spans.push(source.slice(i, end + 1));
    i = end + 1;
  }
  return spans;
}

function normalizeBody(value: unknown, warnings: string[]): StoryBlock[] {
  if (!Array.isArray(value)) throw new NarrativeTurnParseError('INVALID_REQUIRED_FIELD');
  return value.flatMap((item): StoryBlock[] => {
    if (!isRecord(item)) return [];
    const text = requiredText(item.text);
    if (!text) return [];
    const id = optionalText(item.id);
    const speaker = optionalText(item.speaker);
    const kind = STORY_BLOCK_KINDS.includes(item.kind as StoryBlock['kind'])
      ? item.kind as StoryBlock['kind']
      : 'narration';
    if (kind === 'narration' && item.kind !== 'narration') {
      warnings.push(`未知正文块 kind「${String(item.kind ?? '缺失')}」已降级为 narration，文本已保留。`);
    }
    return [{
      kind,
      text,
      ...(id ? { id } : {}),
      ...(speaker ? { speaker } : {}),
    }];
  });
}

export function normalizeNarrativeEvidence(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .trim();
}

export function narrativeEvidenceMatches(bodyText: string, evidence: string): boolean {
  if (bodyText.includes(evidence)) return true;
  const normalizedBody = normalizeNarrativeEvidence(bodyText);
  const normalizedEvidence = normalizeNarrativeEvidence(evidence);
  return Boolean(normalizedBody && normalizedEvidence && normalizedBody.includes(normalizedEvidence));
}

function normalizeChoices(value: unknown): PlayerChoice[] {
  if (!Array.isArray(value)) throw new NarrativeTurnParseError('INVALID_REQUIRED_FIELD');
  const ids = new Set<string>();
  return value.flatMap((item): PlayerChoice[] => {
    if (!isRecord(item)) return [];
    const id = requiredText(item.id);
    const label = requiredText(item.label);
    if (!id || !label || ids.has(id)) return [];
    ids.add(id);
    return [{ id, label }];
  });
}

function normalizeFactCandidates(value: unknown, body: readonly StoryBlock[]): FactCandidate[] {
  if (!Array.isArray(value)) throw new NarrativeTurnParseError('INVALID_REQUIRED_FIELD');
  return value.flatMap((item): FactCandidate[] => {
    if (!isRecord(item) || !FACT_CANDIDATE_DOMAINS.includes(item.domain as FactCandidate['domain'])) return [];
    const fact = requiredText(item.fact);
    const evidence = requiredText(item.evidence);
    if (!fact || !evidence || !body.some((block) => narrativeEvidenceMatches(block.text, evidence))) return [];
    return [{ domain: item.domain as FactCandidate['domain'], fact, evidence }];
  });
}

export function revalidateFactCandidatesForBody(
  value: unknown,
  body: readonly StoryBlock[],
): FactCandidate[] {
  return normalizeFactCandidates(value, body);
}

function normalizeContinuation(value: unknown): NarrativeTurn['continuation'] {
  if (!isRecord(value) || !Array.isArray(value.unresolved)) {
    throw new NarrativeTurnParseError('INVALID_REQUIRED_FIELD');
  }
  const summary = typeof value.summary === 'string' ? value.summary.trim() : null;
  if (summary === null) throw new NarrativeTurnParseError('INVALID_REQUIRED_FIELD');
  const unresolved = Array.from(new Set(value.unresolved.flatMap((item) => {
    const text = requiredText(item);
    return text ? [text] : [];
  })));
  return { summary, unresolved };
}

export function normalizeNarrativeTurn(value: unknown): NarrativeTurn {
  if (!isRecord(value)) throw new NarrativeTurnParseError('INVALID_ROOT');
  if (!('body' in value) || !('choices' in value) || !('factCandidates' in value) || !('continuation' in value)) {
    throw new NarrativeTurnParseError('INVALID_REQUIRED_FIELD');
  }
  const warnings: string[] = [];
  const rawBody = normalizeBody(value.body, warnings);
  const rawContinuation = normalizeContinuation(value.continuation);

  // 预设输出外壳过滤（2026-10-03）：MoM 系预设把思维链、摘要、角色表都包在标签里，
  // 模型会老老实实把它们写进 body.text —— 玩家实测的结果是「正文里夹着 <thinking> 和流程图」。
  // 这里在**解析层**统一摘除外壳：思维链不再进可见正文（另存诊断），
  // `<meow_FM>` 并入续写摘要，`<char_date>` 等面板变成独立的 system 块。
  const shellFiltered = filterNarrativeTurnShell({
    body: rawBody,
    choices: [],
    factCandidates: [],
    continuation: rawContinuation,
  });
  const body = shellFiltered.turn.body;
  if (shellFiltered.removedTags.length) {
    const thinkingNote = shellFiltered.thinkingChars
      ? `（思维链 ${shellFiltered.thinkingChars} 字已从正文移除并存入消息诊断）`
      : '';
    const metaChars = shellFiltered.meta.reduce((total, item) => total + [...item].length, 0);
    const metaNote = shellFiltered.meta.length
      ? `（已丢弃 ${shellFiltered.meta.length} 段免责声明/元信息，共 ${metaChars} 字）`
      : '';
    warnings.push(`已移除预设输出外壳标签：${shellFiltered.removedTags.join('、')}${thinkingNote}${metaNote}。`);
  }

  const turn: NarrativeTurn = {
    body,
    choices: normalizeChoices(value.choices),
    factCandidates: revalidateFactCandidatesForBody(value.factCandidates, body),
    continuation: shellFiltered.turn.continuation,
  };
  if (shellFiltered.thinking) narrativeTurnPresetCot.set(turn, shellFiltered.thinking);
  if (warnings.length) narrativeTurnNormalizationWarnings.set(turn, warnings);
  return turn;
}

export function buildManuallyEditedNarrativeTurn(
  turn: NarrativeTurn,
  rawBody: string,
): NarrativeTurn | null {
  const text = requiredText(rawBody);
  if (!text) return null;
  return normalizeNarrativeTurn({
    body: [{ kind: 'narration', text }],
    choices: turn.choices,
    factCandidates: [],
    continuation: turn.continuation,
  });
}

export function parseNarrativeTurn(raw: string): NarrativeTurn {
  return normalizeNarrativeTurn(parseJsonWithOneFenceRepair(raw));
}
