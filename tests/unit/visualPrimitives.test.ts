import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) return collectSourceFiles(path);
    return /\.tsx?$/u.test(name) ? [path] : [];
  });
}

describe('shared visual primitives', () => {
  it('centralizes the repeated clipped-corner geometry', () => {
    const primitivePath = resolve(process.cwd(), 'styles/clipPaths.ts');
    expect(existsSync(primitivePath)).toBe(true);
    if (!existsSync(primitivePath)) return;

    const primitiveSource = readFileSync(primitivePath, 'utf8');
    expect(primitiveSource).toContain('export const CLIP_SMALL');
    expect(primitiveSource).toContain('export const CLIP_CARD');
    expect(primitiveSource).toContain('export const CLIP_ITEM');
    expect(primitiveSource).toContain('export const CLIP_PANEL');
    expect(primitiveSource).toContain('export function insetRing');
    expect(primitiveSource).toContain('export function gradientAccent');

    const componentSource = collectSourceFiles(resolve(process.cwd(), 'components'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    for (const size of [4, 6, 7, 8, 10, 12, 14, 16, 18]) {
      const literal = `polygon(${size}px 0, 100% 0, 100% calc(100% - ${size}px), calc(100% - ${size}px) 100%, 0 100%, 0 ${size}px)`;
      expect(componentSource, `${size}px clipped-corner literal should use a shared token`).not.toContain(literal);
    }
  });
});
