import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_IMAGE_RETRY_COUNT,
  readImageError,
  runImageGenerationWithRetry,
} from '@/utils/imageGenerationRetry';

/**
 * 契约来源：utils/imageGenerationRetry.ts
 * 生产调用点：components/features/GameSystems/AlbumPanel.tsx:485/560、
 *             components/features/GameSystems/album/workspaces.tsx:43。
 * 关键行为：默认最多重试 2 次（共 3 次尝试）、退避为 1200ms*attempt（上限 5000ms）、
 * 只在「还有重试机会」时回调 onRetry、abort 时不重试也不吞错。
 */
describe('imageGenerationRetry: readImageError', () => {
  it('uses the thrown error message when it is a non-blank string', () => {
    expect(readImageError(new Error('接口 429'))).toBe('接口 429');
    expect(readImageError(new Error('  429  '))).toBe('429');
    expect(readImageError({ message: '服务不可用' })).toBe('服务不可用');
  });

  it('falls back for anything without a usable message', () => {
    expect(readImageError(undefined)).toBe('图片生成失败');
    expect(readImageError(null)).toBe('图片生成失败');
    expect(readImageError(new Error(''))).toBe('图片生成失败');
    expect(readImageError('直接抛字符串')).toBe('图片生成失败');
    expect(readImageError({ message: 404 })).toBe('图片生成失败');
    expect(readImageError({ message: '   ' })).toBe('图片生成失败');
  });

  it('honours a custom fallback label', () => {
    expect(readImageError({}, '封面生成失败')).toBe('封面生成失败');
  });
});

describe('imageGenerationRetry: runImageGenerationWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 模块内部使用 window.setTimeout / window.clearTimeout。
    vi.stubGlobal('window', globalThis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns the first successful result without retrying', async () => {
    const runner = vi.fn(async () => 'ok');
    const onAttempt = vi.fn();
    const onRetry = vi.fn();

    await expect(runImageGenerationWithRetry(runner, { onAttempt, onRetry })).resolves.toBe('ok');

    expect(runner).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledWith(1, DEFAULT_IMAGE_RETRY_COUNT + 1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries up to the default count and keeps the final error when every attempt fails', async () => {
    const failure = new Error('生成超时');
    const runner = vi.fn(async () => {
      throw failure;
    });
    const onRetry = vi.fn();

    const promise = runImageGenerationWithRetry(runner, { onRetry });
    const assertion = expect(promise).rejects.toBe(failure);

    await vi.advanceTimersByTimeAsync(1200);
    await vi.advanceTimersByTimeAsync(2400);
    await assertion;

    expect(runner).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map(([attempt, total, message]) => [attempt, total, message])).toEqual([
      [1, 3, '生成超时'],
      [2, 3, '生成超时'],
    ]);
  });

  it('stops retrying as soon as one attempt succeeds', async () => {
    let calls = 0;
    const runner = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new Error('第一次失败');
      return 'recovered';
    });

    const promise = runImageGenerationWithRetry(runner);
    await vi.advanceTimersByTimeAsync(1200);

    await expect(promise).resolves.toBe('recovered');
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('honours maxRetries: 0 by trying exactly once', async () => {
    const failure = new Error('只允许一次');
    const runner = vi.fn(async () => {
      throw failure;
    });
    const onAttempt = vi.fn();
    const onRetry = vi.fn();

    await expect(runImageGenerationWithRetry(runner, { maxRetries: 0, onAttempt, onRetry })).rejects.toBe(failure);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledWith(1, 1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('caps the backoff delay at 5 seconds for large retry counts', async () => {
    const runner = vi.fn(async () => {
      throw new Error('总是失败');
    });

    const promise = runImageGenerationWithRetry(runner, { maxRetries: 6 });
    const assertion = expect(promise).rejects.toThrow('总是失败');

    expect(runner).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1199);
    expect(runner).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(runner).toHaveBeenCalledTimes(2);

    // 退避依次是 1200 / 2400 / 3600 / 4800，累计到第 5 次尝试。
    await vi.advanceTimersByTimeAsync(2400);
    expect(runner).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(3600);
    expect(runner).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(4800);
    expect(runner).toHaveBeenCalledTimes(5);

    // 第 6 次退避按公式是 1200*5=6000ms，必须被截到 5000ms。
    await vi.advanceTimersByTimeAsync(4999);
    expect(runner).toHaveBeenCalledTimes(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(runner).toHaveBeenCalledTimes(6);

    // 第 7 次退避同样被截到 5000ms（原公式 7200ms），之后第 7 次尝试直接抛出。
    await vi.advanceTimersByTimeAsync(4999);
    expect(runner).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(1);
    expect(runner).toHaveBeenCalledTimes(7);
    await assertion;
  });

  it('rejects with AbortError before the first attempt when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = vi.fn(async () => 'never');

    await expect(runImageGenerationWithRetry(runner, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(runner).not.toHaveBeenCalled();
  });

  it('forwards the signal to the runner and gives up immediately when aborted mid-flight', async () => {
    const controller = new AbortController();
    const runner = vi.fn(async (signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      throw new Error('aborted by user');
    });
    const onRetry = vi.fn();

    await expect(
      runImageGenerationWithRetry(runner, { signal: controller.signal, onRetry }),
    ).rejects.toThrow('aborted by user');

    expect(runner).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('stops waiting for the backoff as soon as the caller aborts', async () => {
    const controller = new AbortController();
    const firstFailure = new Error('第一次失败');
    const runner = vi
      .fn<(signal?: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(firstFailure)
      .mockResolvedValue('不该被调用');

    const promise = runImageGenerationWithRetry(runner, { signal: controller.signal });
    let rejection: unknown;
    promise.catch((error: unknown) => {
      rejection = error;
    });

    // 让 runner 的 rejection 被循环捕获并进入 1200ms 退避等待，再中止。
    await vi.advanceTimersByTimeAsync(100);
    expect(runner).toHaveBeenCalledTimes(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);

    expect((rejection as { name?: string } | undefined)?.name).toBe('AbortError');
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('normalises a non-numeric maxRetries to the safest single attempt', async () => {
    const runner = vi.fn(async () => {
      throw new Error('失败');
    });

    await expect(
      runImageGenerationWithRetry(runner, { maxRetries: Number.NaN }),
    ).rejects.toThrow('失败');

    expect(runner).toHaveBeenCalledTimes(1);
  });
});
