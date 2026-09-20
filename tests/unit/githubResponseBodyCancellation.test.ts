import { describe, expect, it, vi } from 'vitest';
import { readGitHubResponseBytes } from '@/services/githubRequest';

describe('GitHub response body cancellation', () => {
  it('cancels a pending body reader when the user aborts', async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => {}),
      cancel: cancelled,
    });
    const controller = new AbortController();
    const reading = readGitHubResponseBytes(new Response(stream), {
      signal: controller.signal,
      timeoutMs: 5_000,
      phase: '下载测试分卷',
    });

    controller.abort(new DOMException('玩家取消', 'AbortError'));

    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('concatenates a streamed response without falling back to arrayBuffer', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    }));
    const arrayBuffer = vi.spyOn(response, 'arrayBuffer');

    await expect(readGitHubResponseBytes(response, { timeoutMs: 1_000 })).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('cancels a stalled body when the transfer timeout expires', async () => {
    vi.useFakeTimers();
    try {
      const cancelled = vi.fn();
      const response = new Response(new ReadableStream<Uint8Array>({
        pull: () => new Promise(() => {}),
        cancel: cancelled,
      }));
      const reading = readGitHubResponseBytes(response, { timeoutMs: 25, phase: '下载分卷' });

      const rejection = expect(reading).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(25);
      await rejection;
      expect(cancelled).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
