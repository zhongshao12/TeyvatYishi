import { describe, expect, it } from 'vitest';
import { parseGameClock } from '@/utils/gameClock';

/**
 * 契约来源：utils/gameClock.ts
 * 生产调用点：hooks/useGame/worldEvolution.ts:72、components/layout/TopBar.tsx:249、
 *             models/world.ts:739、services/ai/openingArchive.ts:222。
 * 调用方统一按 `const parsed = parseGameClock(raw); if (parsed) return parsed;` 使用，
 * 因此「无法解析」必须返回空字符串（falsy），而不是抛异常或返回原文。
 * 最担心静默出错的点：12:75、99:99 这类越界时间被**钳制**成看似合法的时刻，
 * 以及 "1:234" 这类超长数字被截取前两位当分钟。
 */
describe('gameClock: parseGameClock', () => {
  it('returns an empty string for missing / blank input', () => {
    expect(parseGameClock(undefined)).toBe('');
    expect(parseGameClock(null)).toBe('');
    expect(parseGameClock('')).toBe('');
    expect(parseGameClock('   ')).toBe('');
  });

  it('returns an empty string when the text contains no HH:mm token', () => {
    expect(parseGameClock('清晨')).toBe('');
    expect(parseGameClock('6点40分')).toBe('');
    expect(parseGameClock('现在时刻待定')).toBe('');
    expect(parseGameClock('配置:594')).toBe('');
    expect(parseGameClock('foo:bar')).toBe('');
  });

  it('extracts the clock token and zero-pads both fields', () => {
    expect(parseGameClock('6:40')).toBe('06:40');
    expect(parseGameClock('06:40')).toBe('06:40');
    expect(parseGameClock('23:59')).toBe('23:59');
    expect(parseGameClock('00:00')).toBe('00:00');
  });

  it('extracts the first clock token out of surrounding prose', () => {
    expect(parseGameClock('当前时间 06:40，天气晴朗')).toBe('06:40');
    expect(parseGameClock('第 3 天 · 21:30')).toBe('21:30');
    expect(parseGameClock('06:40 出发，18:20 抵达')).toBe('06:40');
  });

  it('clamps out-of-range hours and minutes instead of producing an invalid clock', () => {
    expect(parseGameClock('99:99')).toBe('23:59');
    expect(parseGameClock('24:00')).toBe('23:00');
    expect(parseGameClock('12:75')).toBe('12:59');
    expect(parseGameClock('00:99')).toBe('00:59');
  });

  it('takes only the first two digits after the colon when more are present', () => {
    expect(parseGameClock('1:234')).toBe('01:23');
    expect(parseGameClock('123:45')).toBe('23:45');
  });

  it('returns an empty string when a colon part is not numeric', () => {
    expect(parseGameClock('ab:cd')).toBe('');
    expect(parseGameClock('1:2')).toBe('');
    expect(parseGameClock('1:')).toBe('');
    expect(parseGameClock(':30')).toBe('');
  });

  it('is side-effect free for the same input', () => {
    expect(parseGameClock('6:40')).toBe(parseGameClock('6:40'));
  });
});
