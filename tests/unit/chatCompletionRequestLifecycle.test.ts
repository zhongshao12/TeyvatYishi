import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEventListeners } from 'node:events';
import type { API配置项 } from '@/models/settings';

/**
 * B05：非流式请求的生命周期。
 *
 * 旧实现只在「等待响应头」阶段挂计时器与上层 AbortSignal，fetch 一返回响应头就
 * 清除计时器并摘掉 abort 转发。于是响应头已到、正文悬挂时：
 *  - 调用方取消（停止按钮）不会取消网络请求，函数永远不完成；
 *  - 没有任何正文看门狗，付费请求会一直挂着。
 * 另外入口没有检查已取消的 signal，预先取消仍会真的发出 fetch。
 */

const apiErrorReports = vi.hoisted(() => ({
  appended: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../services/ai/apiErrorReportService', () => ({
  API_ERROR_REPORTS_KEY: 'apiErrorReports',
  sanitizeApiErrorReportUrl: (value: string | undefined) => value,
  appendApiErrorReport: async (input: Record<string, unknown>) => {
    apiErrorReports.appended.push(input);
  },
}));

import {
  chatCompletion,
  chatCompletionNonStream,
  DEFAULT_STREAM_FIRST_BYTE_TIMEOUT_MS,
} from '../../services/ai/chatCompletionClient';

function config(): API配置项 {
  return {
    id: 'lifecycle-test',
    name: 'lifecycle test',
    provider: 'openai_compatible',
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'test-key',
    model: 'test-model',
    createdAt: 1,
    updatedAt: 1,
  };
}

function baseRequest() {
  return {
    messages: [{ role: 'user' as const, content: '你好' }],
    deepSeekRecovery: 'disabled' as const,
  };
}

type StalledBody = {
  response: Response;
  /** 网络层信号（fetch 收到的 signal）被触发时置位。 */
  networkAborted: () => boolean;
  /** 正文流被 reader.cancel() 取消时置位。 */
  bodyCancelled: () => boolean;
  /** 释放悬挂的正文读取，避免测试结束时留下未完成的流。 */
  release: () => void;
};

/**
 * 已返回响应头、正文永不完成的响应。正文可被 reader.cancel()（调用方取消）或 release()（测试收尾）解除悬挂。
 */
function stalledResponse(status: number, networkSignal?: AbortSignal | null): StalledBody {
  let aborted = false;
  let cancelled = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const closeStream = () => {
    try {
      streamController?.close();
    } catch {
      // 已关闭或已取消。
    }
  };
  let finish: (() => void) | null = null;
  networkSignal?.addEventListener('abort', () => { aborted = true; }, { once: true });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      finish = closeStream;
      controller.enqueue(new TextEncoder().encode('{"choices":'));
    },
    pull() {
      return new Promise<void>((resolve, reject) => {
        finish = () => {
          closeStream();
          resolve();
        };
        if (cancelled) reject(new DOMException('cancelled', 'AbortError'));
      });
    },
    cancel() {
      cancelled = true;
      finish?.();
    },
  });
  return {
    response: new Response(body, { status, headers: { 'Content-Type': 'application/json' } }),
    networkAborted: () => aborted,
    bodyCancelled: () => cancelled,
    release: () => finish?.(),
  };
}

const SETTLED = 'settled';

type SettleOutcome<T> =
  | typeof SETTLED
  | { readonly settled: true; readonly value?: T; readonly error?: unknown };

/**
 * 立刻接住 promise 的落定结果，避免悬挂中的 promise 被当成「未处理拒绝」上报。
 */
function track<T>(promise: Promise<T>): { outcome: Promise<SettleOutcome<T>> } {
  const outcome = promise.then(
    (value): SettleOutcome<T> => ({ settled: true, value }),
    (error: unknown): SettleOutcome<T> => ({ settled: true, error }),
  );
  return { outcome };
}

/**
 * 等待已跟踪的 promise 落定；超时返回 'settled' 标记本身。
 * 不用 Promise.race 抛错：那会把悬挂中的 promise 当成「未处理拒绝」上报，污染测试结果。
 */
async function settleWithin<T>(tracked: { outcome: Promise<SettleOutcome<T>> }, ms: number): Promise<SettleOutcome<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      tracked.outcome,
      new Promise<SettleOutcome<T>>((resolve) => {
        timer = setTimeout(() => resolve(SETTLED), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function thrownBy<T>(outcome: SettleOutcome<T>): Error | undefined {
  expect(outcome).not.toBe(SETTLED);
  const error = (outcome as { error?: unknown }).error;
  return error instanceof Error ? error : undefined;
}

const stalled: StalledBody[] = [];

afterEach(() => {
  for (const item of stalled.splice(0)) item.release();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

beforeEach(() => {
  apiErrorReports.appended.length = 0;
});

describe('non-stream request lifecycle', () => {
  it('times out a streaming HTTP error body and removes its upstream listener', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const body = stalledResponse(500);
    stalled.push(body);
    vi.stubGlobal('fetch', async () => body.response);
    const tracked = track(chatCompletion(config(), { ...baseRequest(), signal: controller.signal }, {
      onDelta: () => {}, onDone: () => {}, onError: () => {},
    }));
    let completed = false;
    void tracked.outcome.then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DEFAULT_STREAM_FIRST_BYTE_TIMEOUT_MS + 1000);
    expect(completed).toBe(true);
    expect(thrownBy(await tracked.outcome)?.name).toBe('StreamTimeoutError');
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('removes abort forwarding after successful requests sharing one turn signal', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content: '收到' } }] })));
    for (let index = 0; index < 6; index += 1) {
      expect(await chatCompletionNonStream(config(), { ...baseRequest(), signal: controller.signal })).toBe('收到');
    }
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('removes abort forwarding when fetch fails before response headers', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', async () => { throw new Error('NETWORK_DOWN'); });
    await expect(chatCompletionNonStream(config(), { ...baseRequest(), signal: controller.signal })).rejects.toThrow('NETWORK_DOWN');
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('rejects immediately without calling fetch when the signal is already aborted', async () => {
    const fetchMock = vi.fn(async () => stalledResponse(200).response);
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    controller.abort(new Error('调用方已取消'));

    const outcome = await settleWithin(
      track(chatCompletionNonStream(config(), { ...baseRequest(), signal: controller.signal })),
      300,
    );

    expect(thrownBy(outcome)?.message).toBe('调用方已取消');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts the network request when the caller cancels after the response headers arrived', async () => {
    const controller = new AbortController();
    const bodies: StalledBody[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = stalledResponse(200, init.signal as AbortSignal);
      bodies.push(body);
      stalled.push(body);
      return body.response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const tracked = track(chatCompletionNonStream(config(), { ...baseRequest(), signal: controller.signal }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // 让 fetchWithApiErrorReport 走完响应头阶段（旧实现正是在这里摘掉 abort 转发与计时器的）。
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.abort(new Error('用户点了停止'));

    const outcome = await settleWithin(tracked, 800);
    expect(thrownBy(outcome)?.message).toBe('用户点了停止');
    expect(bodies[0]?.networkAborted()).toBe(true);
    expect(bodies[0]?.bodyCancelled()).toBe(true);
  });

  it('times out a stalled JSON body and reports a body-phase timeout instead of hanging forever', { timeout: 2000 }, async () => {
    vi.useFakeTimers();
    const body = stalledResponse(200);
    stalled.push(body);
    vi.stubGlobal('fetch', vi.fn(async () => body.response));

    const tracked = track(chatCompletionNonStream(config(), baseRequest()));
    // 先让响应头阶段与正文读取启动，再推进过看门狗。
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DEFAULT_STREAM_FIRST_BYTE_TIMEOUT_MS + 1000);

    const error = thrownBy(await settleWithin(tracked, 500));
    expect(error?.name).toBe('StreamTimeoutError');
    expect(error?.message).toContain('正文');
    expect(error?.message).toContain('45 秒');
  });

  it('times out a stalled error body instead of waiting on it forever', { timeout: 2000 }, async () => {
    vi.useFakeTimers();
    const body = stalledResponse(500);
    stalled.push(body);
    vi.stubGlobal('fetch', vi.fn(async () => body.response));

    const tracked = track(chatCompletionNonStream(config(), baseRequest()));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(DEFAULT_STREAM_FIRST_BYTE_TIMEOUT_MS + 1000);

    const error = thrownBy(await settleWithin(tracked, 500));
    expect(error?.name).toBe('StreamTimeoutError');
    expect(error?.message).toContain('正文');
    // 错误正文停滞时也必须真的结束请求，而不是永远挂在错误分支里。
    expect(apiErrorReports.appended.every((entry) => entry.requestMode === 'non-stream')).toBe(true);
  });

  it('still completes a healthy non-stream request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: '风起地' } }] })));

    await expect(chatCompletionNonStream(config(), baseRequest())).resolves.toBe('风起地');
  });

  it('keeps header-phase timeouts distinct from body-phase timeouts', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      (init.signal as AbortSignal).addEventListener(
        'abort',
        () => reject((init.signal as AbortSignal).reason),
        { once: true },
      );
    }));
    vi.stubGlobal('fetch', fetchMock);

    const tracked = track(chatCompletionNonStream(config(), baseRequest()));
    await vi.advanceTimersByTimeAsync(DEFAULT_STREAM_FIRST_BYTE_TIMEOUT_MS + 1000);

    const error = thrownBy(await settleWithin(tracked, 1000));
    expect(error?.name).toBe('StreamTimeoutError');
    expect(error?.message).toContain('响应头');
    expect(error?.message).not.toContain('正文');
  });
});
