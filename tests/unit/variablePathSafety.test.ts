import { describe, expect, it } from 'vitest';
import { 应用路径命令, 读取路径值 } from '@/utils/variablePath';

describe('shared variable path safety', () => {
  it.each(['__proto__.polluted', 'constructor.prototype.polluted', 'safe.__proto__']) (
    'rejects unsafe mutation path %s',
    (path) => {
      const result = 应用路径命令({}, path, 'set', 'polluted');

      expect(result.ok).toBe(false);
      expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    },
  );

  it('does not read inherited properties as registered state paths', () => {
    const inherited = { secret: 'prototype-value' };
    const value = Object.create(inherited) as Record<string, unknown>;

    expect(读取路径值(value, 'secret')).toEqual({ exists: false, value: undefined });
  });

  it('drops unsafe keys while merging a root object', () => {
    const malicious = JSON.parse('{"safe":1,"__proto__":{"polluted":true}}') as unknown;
    const result = 应用路径命令({}, '', 'set', malicious);

    expect(result.ok).toBe(true);
    expect(result.nextRootValue).toEqual({ safe: 1 });
    expect(Object.getPrototypeOf(result.nextRootValue)).toBe(Object.prototype);
  });
});
