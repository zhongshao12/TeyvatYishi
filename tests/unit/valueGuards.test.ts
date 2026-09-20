import { describe, expect, it } from 'vitest';
import { isRecord, readTrimmedText } from '@/utils/valueGuards';

describe('shared value guards', () => {
  it('accepts plain records but rejects arrays and null', () => {
    expect(isRecord({ value: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });

  it('only trims string values', () => {
    expect(readTrimmedText('  蒙德  ')).toBe('蒙德');
    expect(readTrimmedText(7)).toBe('');
  });
});
