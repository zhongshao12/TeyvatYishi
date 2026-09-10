import {
  FACT_CANDIDATE_DOMAINS,
  STORY_BLOCK_KINDS,
  type FactCandidate,
  type NarrativeTurn,
  type PlayerChoice,
  type StoryBlock,
} from '@/models/teyvat/narrativeTurn';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
      return JSON.parse(fenceMatches[i][1].trim());
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

function normalizeBody(value: unknown): StoryBlock[] {
  if (!Array.isArray(value)) throw new NarrativeTurnParseError('INVALID_REQUIRED_FIELD');
  return value.flatMap((item): StoryBlock[] => {
    if (!isRecord(item) || !STORY_BLOCK_KINDS.includes(item.kind as StoryBlock['kind'])) return [];
    const text = requiredText(item.text);
    if (!text) return [];
    const id = optionalText(item.id);
    const speaker = optionalText(item.speaker);
    return [{
      kind: item.kind as StoryBlock['kind'],
      text,
      ...(id ? { id } : {}),
      ...(speaker ? { speaker } : {}),
    }];
  });
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
    if (!fact || !evidence || !body.some((block) => block.text.includes(evidence))) return [];
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
  const body = normalizeBody(value.body);
  return {
    body,
    choices: normalizeChoices(value.choices),
    factCandidates: revalidateFactCandidatesForBody(value.factCandidates, body),
    continuation: normalizeContinuation(value.continuation),
  };
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
