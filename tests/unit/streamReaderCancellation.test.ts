import { describe, expect, it, vi } from 'vitest';
import * as chatCompletionClient from '@/services/ai/chatCompletionClient';

describe('stream reader cancellation', () => {
  it('cancels the underlying stream before releasing its lock', async () => {
    let cancelReason: unknown;
    const stream = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancelReason = reason;
      },
    });
    const reader = stream.getReader();
    const cancelReader = Reflect.get(
      chatCompletionClient,
      'cancelReadableStreamReader',
    ) as undefined | ((target: ReadableStreamDefaultReader<Uint8Array>, reason?: unknown) => Promise<void>);

    expect(cancelReader).toBeTypeOf('function');
    await cancelReader?.(reader, 'request-finished');

    expect(cancelReason).toBe('request-finished');
    expect(() => reader.releaseLock()).not.toThrow();
  });

  it('parses fragmented SSE frames through one shared reader', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"delta":"甲"}\n\ndata: {"del'));
        controller.enqueue(encoder.encode('ta":"乙"}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    const onData = vi.fn();
    const readSseStream = Reflect.get(chatCompletionClient, 'readSseStream') as undefined | ((
      response: Response,
      signal: AbortSignal | undefined,
      listener: (data: unknown) => void,
    ) => Promise<void>);

    expect(readSseStream).toBeTypeOf('function');
    await readSseStream?.(new Response(stream), undefined, onData);

    expect(onData.mock.calls.map(([value]) => value)).toEqual([{ delta: '甲' }, { delta: '乙' }]);
  });

  it('cancels a stream that never produces its first byte', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    await expect(chatCompletionClient.readSseStream(
      new Response(stream),
      undefined,
      vi.fn(),
      { firstByteTimeoutMs: 5, idleTimeoutMs: 5 },
    )).rejects.toMatchObject({ name: 'StreamTimeoutError' });
    expect(cancelled).toBe(true);
  });

  it('propagates a consumer failure instead of treating it as a malformed SSE frame', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"delta":"甲"}\n\ndata: {"delta":"乙"}\n\n'));
        controller.close();
      },
    });
    const onData = vi.fn(() => { throw new Error('consumer failed'); });

    await expect(chatCompletionClient.readSseStream(new Response(stream), undefined, onData))
      .rejects.toThrow('consumer failed');
    expect(onData).toHaveBeenCalledTimes(1);
  });

  it('stops dispatching frames already buffered when the consumer aborts', async () => {
    const encoder = new TextEncoder();
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(target) {
        target.enqueue(encoder.encode('data: {"delta":"甲"}\n\ndata: {"delta":"乙"}\n\n'));
        target.close();
      },
    });
    const received: string[] = [];

    await expect(chatCompletionClient.readSseStream(new Response(stream), controller.signal, (data) => {
      received.push(data.delta);
      controller.abort();
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(received).toEqual(['甲']);
  });
});
