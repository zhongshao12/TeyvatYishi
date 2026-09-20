import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/ai/apiErrorReportService', () => ({
  appendApiErrorReport: vi.fn(async () => undefined),
}));

import { fetchModels } from '@/services/ai/apiTools';
import { withRetries } from '@/services/ai/retry';

describe('retry cancellation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not start another paid attempt when cancellation happens during backoff', async () => {
    const controller = new AbortController();
    let attempts = 0;
    const request = withRetries(
      async () => {
        attempts += 1;
        throw new Error('temporary provider failure');
      },
      { retries: 3, delayMs: 50, signal: controller.signal },
    );

    setTimeout(() => controller.abort(new DOMException('用户已取消。', 'AbortError')), 5);

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempts).toBe(1);
  });

  it('forwards cancellation to model-list network requests', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      throw new DOMException('用户已取消。', 'AbortError');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchModels({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'test-key',
      retryCount: 2,
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
