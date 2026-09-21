type ParseAttempt<T> = {
  ok: boolean;
  value: T | null;
  error?: string;
};

export interface JsonRepairResult<T = unknown> {
  value: T | null;
  repairedText: string;
  usedRepair: boolean;
  error?: string;
}

const tryParse = <T = unknown>(input: string): ParseAttempt<T> => {
  try {
    return { ok: true, value: JSON.parse(input) as T };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'JSON 解析失败';
    return { ok: false, value: null, error: message };
  }
};

const stripFence = (input: string): string => {
  const trimmed = input.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  return trimmed;
};

const extractJsonBlock = (input: string): string => {
  const start = input.indexOf('{');
  const end = input.lastIndexOf('}');
  if (start >= 0 && end > start) return input.slice(start, end + 1);
  return input;
};

const replaceOutsideStrings = (input: string, mapper: (ch: string) => string): string => {
  let result = '';
  let inString = false;
  let escaped = false;

  for (const ch of input) {
    if (inString) {
      result += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }
    result += mapper(ch);
  }

  return result;
};

const normalizeFullWidthPunctuation = (input: string): string => {
  const map: Record<string, string> = {
    '“': '"',
    '”': '"',
    '‘': "'",
    '’': "'",
    '，': ',',
    '：': ':',
    '；': ',',
  };
  return replaceOutsideStrings(input, (ch) => map[ch] ?? ch);
};

/**
 * 只在**字符串字面量之外**做正则替换。
 *
 * 为什么必须这样：修复规则（去尾逗号、`/n` → `\n`）如果直接对整个文本跑正则，
 * 会把**字符串内容**改坏 —— 例如 `{"path":"dir/nfile"}` 里的路径被改成换行、
 * `{"note":"见 A,B}"}` 里的逗号被当成尾逗号删掉。第二轮审计在 utils/jsonRepair 里实测到这两个问题。
 */
const replaceOutsideStringsPattern = (input: string, pattern: RegExp, replacement: string): string => {
  let result = '';
  let segment = '';
  let inString = false;
  let escaped = false;
  const flush = () => {
    result += segment.replace(pattern, replacement);
    segment = '';
  };
  for (const ch of input) {
    if (inString) {
      result += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      flush();
      inString = true;
      result += ch;
      continue;
    }
    segment += ch;
  }
  flush();
  return result;
};

const normalizeSlashN = (input: string): string => {
  return replaceOutsideStringsPattern(
    replaceOutsideStringsPattern(input, /\\\/n/g, '\\n'),
    /\/n/g,
    '\\n',
  );
};

/** 去掉尾逗号（`{"a":1,}` / `[1,2,]`）——最常见的模型 JSON 错误。 */
const dropTrailingCommas = (input: string): string => {
  return replaceOutsideStringsPattern(input, /,(\s*[}\]])/g, '$1');
};

const normalizeBase = (input: string): string => {
  return input.replace(/^\uFEFF/, '').trim();
};

const repairJsonText = (input: string): string => {
  let text = normalizeBase(input);
  text = stripFence(text);
  text = extractJsonBlock(text);
  text = normalizeSlashN(text);
  // 顺序要紧：先把全角标点归一成半角，再去尾逗号 ——
  // 否则 `{"a"：1，}` 里的全角逗号在去尾逗号时还不算逗号，改完又留下一个尾逗号。
  text = normalizeFullWidthPunctuation(text);
  text = dropTrailingCommas(text);
  return text.trim();
};

const dedupeCandidates = (candidates: string[]): string[] => {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const item of candidates) {
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    list.push(value);
  }
  return list;
};

export const parseJsonWithRepair = <T = unknown>(input: string): JsonRepairResult<T> => {
  const source = normalizeBase(input || '');
  const candidates = dedupeCandidates([
    source,
    stripFence(source),
    extractJsonBlock(source),
    extractJsonBlock(stripFence(source)),
  ]);

  for (const candidate of candidates) {
    const parsed = tryParse<T>(candidate);
    if (parsed.ok) {
      return {
        value: parsed.value,
        repairedText: candidate,
        usedRepair: candidate !== source,
      };
    }
  }

  let lastError = 'JSON 解析失败';
  for (const candidate of candidates) {
    const repaired = repairJsonText(candidate);
    const parsed = tryParse<T>(repaired);
    if (parsed.ok) {
      return {
        value: parsed.value,
        repairedText: repaired,
        usedRepair: true,
      };
    }
    if (parsed.error) lastError = parsed.error;
  }

  const fallback = repairJsonText(source);
  return {
    value: null,
    repairedText: fallback,
    usedRepair: true,
    error: lastError,
  };
};

export const formatJsonWithRepair = (input: string, fallback: string): string => {
  const parsed = parseJsonWithRepair<any>(input);
  if (parsed.value === null) return fallback;
  try {
    return JSON.stringify(parsed.value, null, 2);
  } catch {
    return parsed.repairedText || fallback;
  }
};