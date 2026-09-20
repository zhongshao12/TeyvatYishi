import { describe, expect, it } from 'vitest';
import * as cloudBackupPackage from '../../services/cloudBackupPackage';

type LimitedReader = (stream: ReadableStream<Uint8Array>, maxBytes: number) => Promise<Uint8Array>;

async function readWithLimit(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const candidate = Reflect.get(cloudBackupPackage, 'readByteStreamWithLimit') as unknown;
  if (typeof candidate === 'function') return (candidate as LimitedReader)(stream, maxBytes);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe('cloud backup decompression byte limit', () => {
  it('cancels a byte stream before collecting output beyond the limit', async () => {
    let cancelled = false;
    let emitted = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted === 0) controller.enqueue(new Uint8Array([1, 2, 3]));
        else if (emitted === 1) controller.enqueue(new Uint8Array([4, 5, 6]));
        else controller.close();
        emitted += 1;
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(readWithLimit(stream, 4)).rejects.toThrow('云备份分卷解压后大小超过安全上限。');
    expect(cancelled).toBe(true);
  });
});
