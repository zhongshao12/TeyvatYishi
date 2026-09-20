import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { concatBytes, crc32, findEndOfCentralDirectory } from '@/utils/zip';

describe('shared ZIP primitives', () => {
  it('calculates the standard CRC32 check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('concatenates byte ranges and locates EOCD through either view type', () => {
    const bytes = concatBytes([
      new Uint8Array([1, 2, 3]),
      new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
      new Uint8Array(18),
    ]);

    expect(Array.from(bytes.slice(0, 3))).toEqual([1, 2, 3]);
    expect(findEndOfCentralDirectory(bytes)).toBe(3);
    expect(findEndOfCentralDirectory(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength))).toBe(3);
  });

  it('keeps ZIP consumers on the shared implementation', () => {
    const files = [
      'services/savePackage.ts',
      'services/ai/imageGeneration.ts',
      'components/features/GameSystems/album/albumArchive.ts',
    ];
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source).toContain("from '@/utils/zip'");
      expect(source).not.toMatch(/function\s+(?:crc32|concatBytes|findEndOfCentralDirectory)\s*\(/u);
    }
  });
});
