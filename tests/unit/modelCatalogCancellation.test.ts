import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEventListeners } from 'node:events';
import { fetchOpenAICompatibleModels, fetchOpenAICompatibleModelsCached, clearOpenAICompatibleModelCache } from '@/services/ai/openAICompatibleModels';
import { chatCompletion, chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import type { API配置项 } from '@/models/settings';
vi.mock('@/services/ai/apiErrorReportService', () => ({ appendApiErrorReport: vi.fn(async () => undefined) }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); clearOpenAICompatibleModelCache(); });
const config: API配置项 = { id: 'catalog', name: 'catalog', provider: 'deepseek', model: 'deepseek-r1',
  baseUrl: 'https://example.invalid/v1', apiKey: 'test-key', createdAt: 1, updatedAt: 1 };

describe('model catalog full lifecycle cancellation', () => {
  it.each(['stream', 'non-stream'] as const)('forwards %s recovery cancellation into catalog headers and stops fallback', async (mode) => {
    const controller = new AbortController();
    let catalogSignal: AbortSignal | null | undefined;
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('/models')) {
        catalogSignal = init.signal;
        return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
      }
      return mode === 'stream'
        ? new Response('data: {"choices":[{"delta":{"reasoning_content":"reasoning"}}]}\n\n')
        : Response.json({ choices: [{ message: { content: '', reasoning_content: 'reasoning' } }] });
    });
    vi.stubGlobal('fetch', fetcher);
    const request = { messages: [{ role: 'user', content: 'story' }], signal: controller.signal };
    const task = (mode === 'stream' ? chatCompletion(config, request, { onDelta: () => {}, onDone: () => {}, onError: () => {} })
      : chatCompletionNonStream(config, request)).then(() => undefined, (error: unknown) => error);
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes('/models'))).toBe(true));
    controller.abort(new Error('stop catalog'));
    expect(catalogSignal).toBeDefined();
    expect(await task).toMatchObject({ message: 'stop catalog' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('cancels a stalled catalog body after headers without trying another candidate URL', async () => {
    const controller = new AbortController();
    let cancelled = false;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(stream) { stream.enqueue(new TextEncoder().encode('{"data":')); },
      cancel() { cancelled = true; },
    }))));
    const outcome = fetchOpenAICompatibleModels(config.baseUrl, config.apiKey, controller.signal).then(() => undefined, (error: unknown) => error);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort(new Error('stop body'));
    expect(await outcome).toMatchObject({ message: 'stop body' });
    expect(cancelled).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('uses a bounded timeout for catalog headers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) =>
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }))));
    let outcome: unknown;
    void fetchOpenAICompatibleModels(config.baseUrl, config.apiKey).catch((error: unknown) => { outcome = error; });
    await vi.advanceTimersByTimeAsync(46_000);
    expect(outcome).toMatchObject({ name: 'TimeoutError' });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('also times out and cancels a stalled catalog body under the same deadline', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(stream) { stream.enqueue(new TextEncoder().encode('{"data":')); },
      cancel() { cancelled = true; },
    }))));
    let outcome: unknown;
    void fetchOpenAICompatibleModels(config.baseUrl, config.apiKey).catch((error: unknown) => { outcome = error; });
    await vi.advanceTimersByTimeAsync(46_000);
    expect(outcome).toMatchObject({ name: 'TimeoutError' });
    expect(cancelled).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('does not serve cached models or start fetch after caller cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ id: 'deepseek-chat' }] })));
    await fetchOpenAICompatibleModelsCached(config.baseUrl, config.apiKey);
    const controller = new AbortController();
    controller.abort(new Error('already stopped'));
    await expect(fetchOpenAICompatibleModelsCached(config.baseUrl, config.apiKey, controller.signal)).rejects.toThrow('already stopped');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
