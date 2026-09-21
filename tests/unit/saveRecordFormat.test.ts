import { describe, expect, it } from 'vitest';
import { normalizeSaveType, sanitizeSaveFilename } from '@/services/storage/saveRecordFormat';

/**
 * 契约来源：services/storage/saveRecordFormat.ts
 * 生产调用点：services/storage/saveImportExportService.ts:84/94/102（导出文件名）、
 *             services/dbService.ts:89、services/storage/saveCatalog.ts:288。
 * 关注点：存档记录类型降级是否安全、导出文件名是否会被非法字符/超长内容破坏。
 */
describe('saveRecordFormat: normalizeSaveType', () => {
  it('passes through the three non-manual save types', () => {
    expect(normalizeSaveType('auto')).toBe('auto');
    expect(normalizeSaveType('backup')).toBe('backup');
    expect(normalizeSaveType('imported')).toBe('imported');
  });

  it('keeps manual as manual', () => {
    expect(normalizeSaveType('manual')).toBe('manual');
  });

  it('degrades every unknown / malformed value to manual instead of throwing', () => {
    for (const value of [undefined, null, '', 'AUTO', 'Auto', 0, 1, true, false, {}, [], Symbol('auto')]) {
      expect(normalizeSaveType(value)).toBe('manual');
    }
  });

  it('does not accept values that merely contain a known type name', () => {
    expect(normalizeSaveType('auto_backup')).toBe('manual');
    expect(normalizeSaveType(' auto')).toBe('manual');
    expect(normalizeSaveType('auto ')).toBe('manual');
  });
});

describe('saveRecordFormat: sanitizeSaveFilename', () => {
  it('trims the traveler name and keeps ordinary CJK names intact', () => {
    expect(sanitizeSaveFilename('  旅行者  ')).toBe('旅行者');
  });

  it('replaces Windows/POSIX illegal filename characters with underscore', () => {
    expect(sanitizeSaveFilename('a\\b/c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('collapses whitespace runs into a single underscore', () => {
    expect(sanitizeSaveFilename('a   b\tc\nd')).toBe('a_b_c_d');
  });

  it('falls back to traveler when nothing usable remains', () => {
    expect(sanitizeSaveFilename('')).toBe('traveler');
    expect(sanitizeSaveFilename('   ')).toBe('traveler');
    expect(sanitizeSaveFilename('\n\t')).toBe('traveler');
  });

  it('truncates over-long names to 48 characters so the export filename stays bounded', () => {
    const result = sanitizeSaveFilename('x'.repeat(120));
    expect(result).toHaveLength(48);
    expect(result).toBe('x'.repeat(48));
  });

  it('counts CJK characters by code point when truncating', () => {
    expect(sanitizeSaveFilename('旅'.repeat(120))).toBe('旅'.repeat(48));
  });

  it('drops trailing/leading whitespace without leaving a trailing underscore', () => {
    // trim() 在折叠之前执行，因此文件里不会残留空格，也不会残留收尾的下划线。
    expect(sanitizeSaveFilename('a b ')).toBe('a_b');
    expect(sanitizeSaveFilename('a b ')).not.toContain(' ');
    expect(sanitizeSaveFilename('  a b  ')).toBe('a_b');
  });

  it('never returns a string containing path separators for hostile input', () => {
    const result = sanitizeSaveFilename('../../etc/passwd');
    expect(result).not.toContain('/');
    expect(result).toBe('.._.._etc_passwd');
  });
});
