/** Shared with the legacy recognizers; callers requiring exact counts must reject 几/数 themselves. */
export const CHINESE_NARRATIVE_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6,
  七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12,
};
export function parseNarrativeNumber(value: string): number | null {
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value === '几' || value === '数') return 3;
  if (value === '半') return 0.5;
  if (CHINESE_NARRATIVE_DIGITS[value] !== undefined) return CHINESE_NARRATIVE_DIGITS[value];
  const tenIndex = value.indexOf('十');
  if (tenIndex >= 0) {
    const tensText = value.slice(0, tenIndex), onesText = value.slice(tenIndex + 1);
    const tens = tensText ? CHINESE_NARRATIVE_DIGITS[tensText] : 1;
    const ones = onesText ? CHINESE_NARRATIVE_DIGITS[onesText] : 0;
    if (tens !== undefined && ones !== undefined) return tens * 10 + ones;
  }
  if (/^[零〇一二两三四五六七八九十百千]+$/u.test(value)) {
    const units: Array<[string, number]> = [['千', 1000], ['百', 100], ['十', 10]];
    let total = 0, section = 0;
    for (const char of value) {
      if (char === '零' || char === '〇') continue;
      const digit = CHINESE_NARRATIVE_DIGITS[char];
      if (digit !== undefined) { section = digit; continue; }
      const unit = units.find(([token]) => token === char)?.[1];
      if (unit === undefined) return null;
      total += (section || 1) * unit; section = 0;
    }
    const resolved = total + section;
    return resolved > 0 ? resolved : null;
  }
  return null;
}
