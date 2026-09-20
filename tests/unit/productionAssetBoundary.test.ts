import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function countJsonFiles(path: string): number {
  return readdirSync(resolve(path), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .length;
}

describe('production asset boundary', () => {
  it('keeps historical HSR fixtures outside Vite public assets', () => {
    expect(existsSync(resolve('public/zhiku-presets/legacy-hsr'))).toBe(false);
    expect(existsSync(resolve('public/data/story-weaving-canon/legacy-hsr'))).toBe(false);
    expect(countJsonFiles('tests/fixtures/legacy-hsr/zhiku-presets')).toBe(23);
    expect(countJsonFiles('tests/fixtures/legacy-hsr/story-weaving-canon')).toBe(14);
  });
});
