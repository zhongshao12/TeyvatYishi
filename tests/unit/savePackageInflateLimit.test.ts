import { describe, expect, it } from 'vitest';
import { crc32 } from '@/utils/zip';
import { readSavePackageEntries } from '@/services/savePackage';

const PACKAGE_LIMIT_MESSAGE = '存档包解压后大小超过安全上限';

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 手工拼一个只有本地文件头的单条目 ZIP（足够 readSavePackageEntries 读取）。 */
function buildSingleEntryZip(name: string, payload: Uint8Array, compressed: Uint8Array, declaredSize: number): ArrayBuffer {
  const nameBytes = new TextEncoder().encode(name);
  const entry = new Uint8Array(30 + nameBytes.length + compressed.length);
  const view = new DataView(entry.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(8, 8, true);
  view.setUint32(14, crc32(payload), true);
  view.setUint32(18, compressed.length, true);
  view.setUint32(22, declaredSize, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  entry.set(nameBytes, 30);
  entry.set(compressed, 30 + nameBytes.length);
  return entry.buffer;
}

describe('save package decompression limits', () => {
  it('rejects an entry whose declared size already exceeds the unpack limit, before inflating it', async () => {
    const payload = new Uint8Array(4 * 1024 * 1024);
    const compressed = await deflateRaw(payload);
    const zip = buildSingleEntryZip('save.json', payload, compressed, payload.length);

    await expect(readSavePackageEntries(zip, { maxEntryBytes: 1024, maxTotalUnpackedBytes: 4096 }))
      .rejects.toThrow(PACKAGE_LIMIT_MESSAGE);
  });

  it('aborts streaming decompression as soon as the inflated size exceeds the limit', async () => {
    const payload = new Uint8Array(4 * 1024 * 1024);
    const compressed = await deflateRaw(payload);
    // 头部谎报成 64 字节：只有流式限额能在解压过程中拦下这颗炸弹。
    const zip = buildSingleEntryZip('save.json', payload, compressed, 64);

    await expect(readSavePackageEntries(zip, { maxEntryBytes: 1024, maxTotalUnpackedBytes: 4096 }))
      .rejects.toThrow(PACKAGE_LIMIT_MESSAGE);
  });

  it('caps the cumulative inflated size across entries', async () => {
    const single = new Uint8Array(2048);
    const compressed = await deflateRaw(single);
    const first = buildSingleEntryZip('manifest.json', single, compressed, single.length);
    const second = buildSingleEntryZip('save.json', single, compressed, single.length);
    const merged = new Uint8Array(first.byteLength + second.byteLength);
    merged.set(new Uint8Array(first), 0);
    merged.set(new Uint8Array(second), first.byteLength);

    await expect(readSavePackageEntries(merged.buffer, { maxEntryBytes: 4096, maxTotalUnpackedBytes: 3000 }))
      .rejects.toThrow(PACKAGE_LIMIT_MESSAGE);
  });

  it('still reads a package that stays inside the limits', async () => {
    const payload = new TextEncoder().encode('{"kind":"save-package"}');
    const compressed = await deflateRaw(payload);
    const zip = buildSingleEntryZip('manifest.json', payload, compressed, payload.length);

    const files = await readSavePackageEntries(zip);

    expect(files.get('manifest.json')).toBe('{"kind":"save-package"}');
  });
});
