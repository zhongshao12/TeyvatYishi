import { describe, expect, it } from 'vitest';
import vectors from '../../fixtures/core2-js-numbers.json';
import { stableJson } from '@/core/persistence/repositoryValidation';
import { checksumUtf8 } from '@/core/sources/sourceIntegrity';

describe('shared native/JavaScript JSON goldens', () => {
  it('matches independently recorded numbers, including binary midpoint ties', () => {
    for (const [input, expected] of vectors) {
      expect(stableJson(JSON.parse(input!)), input).toBe(expected);
    }
  });

  it('keeps numeric keys in UTF-16 order and uses the same UTF-8 integrity vector', () => {
    const value = { '2': 'two', '10': 'ten', '\uE000': 'private', '😀': 'emoji', a: { '2': 2, '10': 10 } };
    expect(stableJson(value)).toBe('{"10":"ten","2":"two","a":{"10":10,"2":2},"😀":"emoji","\uE000":"private"}');
    expect(checksumUtf8('hello')).toBe('a430d84680aabd0b');
  });
});
