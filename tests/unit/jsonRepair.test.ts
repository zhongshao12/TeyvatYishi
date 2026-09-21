import { describe, expect, it } from 'vitest';
import { formatJsonWithRepair, parseJsonWithRepair } from '@/utils/jsonRepair';

/**
 * 契约来源：utils/jsonRepair.ts
 * 生产调用点：services/ai/narrativeImageParse.ts:305（解析模型返回的宽松 JSON）。
 * 调用方按 `parseJsonWithRepair(text).value` 取值，并依赖 usedRepair 判断是否经过修复，
 * 因此「修不好」必须是 { value: null, error } 而不是抛异常。
 */
describe('jsonRepair: parseJsonWithRepair', () => {
  it('parses already-valid JSON without marking it as repaired', () => {
    const result = parseJsonWithRepair<{ a: number }>('{"a":1}');
    expect(result.value).toEqual({ a: 1 });
    expect(result.usedRepair).toBe(false);
    expect(result.repairedText).toBe('{"a":1}');
    expect(result.error).toBeUndefined();
  });

  it('unwraps a fenced JSON block and reports repair', () => {
    const result = parseJsonWithRepair<{ a: number }>('```json\n{"a":1}\n```');
    expect(result.value).toEqual({ a: 1 });
    expect(result.usedRepair).toBe(true);
  });

  it('extracts the JSON object out of surrounding prose', () => {
    const result = parseJsonWithRepair<{ a: number }>('好的，结果如下：{"a":1} 请查收。');
    expect(result.value).toEqual({ a: 1 });
    expect(result.usedRepair).toBe(true);
  });

  it('tolerates a leading BOM and padding whitespace', () => {
    expect(parseJsonWithRepair<{ a: number }>('\uFEFF  {"a":1}  ').value).toEqual({ a: 1 });
  });

  it('parses top-level arrays as-is', () => {
    expect(parseJsonWithRepair<number[]>('[1,2,3]').value).toEqual([1, 2, 3]);
  });

  it('strips trailing commas on the repair path', () => {
    // 迁移: 第二轮审计发现 utils/jsonRepair 缺少 services/ai/structuredOutputRepair 里的
    // 「去尾逗号」规则 → 最常见的模型坏 JSON（尾逗号）修不好。已补 dropTrailingCommas（只作用于字符串外）。
    expect(parseJsonWithRepair<{ a: number }>('{"a":1,}').value).toEqual({ a: 1 });
    expect(parseJsonWithRepair<number[]>('[1,2,]').value).toEqual([1, 2]);
  });

  it('keeps a comma that lives inside a string value', () => {
    expect(parseJsonWithRepair<{ a: string }>('{"a":"见 A,B}"}').value).toEqual({ a: '见 A,B}' });
  });

  it('rewrites full-width punctuation and then also drops the resulting trailing comma', () => {
    const result = parseJsonWithRepair<{ a: number }>('{"a"：1，}');
    // 迁移: 全角标点被改写后产生尾逗号，现在 dropTrailingCommas 会一并清掉 → 解析成功。
    expect(result.value).toEqual({ a: 1 });
    expect(result.repairedText).toBe('{"a":1}');
    expect(result.usedRepair).toBe(true);
  });

  it('leaves full-width punctuation inside string values untouched', () => {
    expect(parseJsonWithRepair<{ a: string }>('{"a":"，x"}').value).toEqual({ a: '，x' });
    expect(parseJsonWithRepair<{ a: string }>('{"a":"全角：文本"}').value).toEqual({ a: '全角：文本' });
  });

  it('keeps the escaped-slash form itself valid but only rewrites it on the repair path', () => {
    // 原串本身是合法 JSON，parseJsonWithRepair 会直接返回它（不进入修复分支），
    // 因此 \/n 仍按 JSON 语义原样保留。
    expect(parseJsonWithRepair<{ a: string }>('{"a":"l1\\/nl2"}').value).toEqual({ a: 'l1/nl2' });
  });

  it('does not rewrite escape sequences that live inside a string value', () => {
    // 迁移: 第二轮审计发现 normalizeSlashN 不区分字符串内外，会把路径/URL 里的字面 `/n` 改成换行。
    // 已改为只作用于字符串外（复用同文件的 replaceOutsideStrings 思路）→ 串内内容逐字保留。
    expect(parseJsonWithRepair<{ a: string }>('{"a"："l1\\/nl2"}').value).toEqual({ a: 'l1/nl2' });
  });

  it('does not rewrite a bare /n inside a string value', () => {
    expect(parseJsonWithRepair<{ path: string }>('{"path"："dir/nfile"}').value).toEqual({ path: 'dir/nfile' });
  });

  it('returns value:null with an error message when the text cannot be repaired', () => {
    for (const broken of ['{"a":', '这不是 JSON', '{', '}{']) {
      const result = parseJsonWithRepair<unknown>(broken);
      expect(result.value).toBeNull();
      expect(result.usedRepair).toBe(true);
      expect(typeof result.error).toBe('string');
      expect(result.error?.length).toBeGreaterThan(0);
    }
  });

  it('treats an empty or whitespace-only input as unparseable rather than throwing', () => {
    const result = parseJsonWithRepair<unknown>('   ');
    expect(result.value).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('does not rewrite /n sequences when the text is already valid JSON', () => {
    // 现状记录：normalizeSlashN 不区分字符串内外，但只在修复分支执行；
    // 合法 JSON 会原样返回，所以字面 "/n" 只有在必须修复时才会被改成换行。
    const result = parseJsonWithRepair<{ path: string }>('{"path":"dir/nfile"}');
    expect(result.value).toEqual({ path: 'dir/nfile' });
    expect(result.usedRepair).toBe(false);
  });
});

describe('jsonRepair: formatJsonWithRepair', () => {
  it('pretty-prints valid JSON with two-space indentation', () => {
    expect(formatJsonWithRepair('{"a":1}', 'fallback')).toBe('{\n  "a": 1\n}');
  });

  it('returns the fallback when the input cannot be repaired', () => {
    // 迁移: 尾逗号现在能修好（见上），所以这里改用真正修不了的输入来验证 fallback 分支。
    expect(formatJsonWithRepair('{"a":', 'fallback')).toBe('fallback');
    expect(formatJsonWithRepair('这不是 JSON', 'fallback')).toBe('fallback');
  });

  it('pretty-prints a repaired trailing-comma payload instead of falling back', () => {
    expect(formatJsonWithRepair('{"a":1,}', 'fallback')).toBe('{\n  "a": 1\n}');
  });

  it('returns the fallback for the JSON literal null', () => {
    expect(formatJsonWithRepair('null', 'fallback')).toBe('fallback');
  });
});
