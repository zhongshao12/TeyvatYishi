import { describe, expect, it, vi } from 'vitest';
import { runMainNarrativeAttempts } from '@/services/ai/mainNarrativeAttemptRunner';

describe('main narrative attempt runner', () => {
  it('retries validation failures within budget and returns the accepted attempt', async () => {
    const seen: number[] = [];
    const result = await runMainNarrativeAttempts({
      maxAttempts: 3,
      request: async ({ attempt }) => `response-${attempt}`,
      evaluate: async (value, { attempt }) => {
        seen.push(attempt);
        return attempt < 3
          ? { status: 'retry' as const, reason: `invalid-${attempt}` }
          : { status: 'accept' as const, value };
      },
    });

    expect(seen).toEqual([1, 2, 3]);
    expect(result).toEqual({ value: 'response-3', attempt: 3 });
  });

  it('does not issue another request after cancellation', async () => {
    const controller = new AbortController();
    const request = vi.fn(async () => {
      controller.abort(new DOMException('玩家停止生成', 'AbortError'));
      throw controller.signal.reason;
    });

    await expect(runMainNarrativeAttempts({
      maxAttempts: 4,
      signal: controller.signal,
      request,
      evaluate: async (value) => ({ status: 'accept' as const, value }),
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('stops immediately for an explicitly non-retryable provider error', async () => {
    const failure = Object.assign(new Error('invalid api key'), { status: 401 });
    const request = vi.fn(async () => { throw failure; });
    const onAttemptError = vi.fn();

    await expect(runMainNarrativeAttempts({
      maxAttempts: 3,
      request,
      evaluate: async (value) => ({ status: 'accept' as const, value }),
      isNonRetryableError: (error) => (error as { status?: number }).status === 401,
      onAttemptError,
    })).rejects.toBe(failure);
    expect(request).toHaveBeenCalledTimes(1);
    expect(onAttemptError).toHaveBeenCalledTimes(1);
  });

  it('rejects the final validation failure instead of returning an invalid response', async () => {
    const invalid = new Error('AI response was empty');
    const request = vi.fn(async () => '');

    await expect(runMainNarrativeAttempts({
      maxAttempts: 2,
      request,
      evaluate: async () => ({ status: 'retry' as const, reason: 'blank', exhaustedError: invalid }),
    })).rejects.toBe(invalid);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('retries a transient exception thrown while evaluating a provider response', async () => {
    let evaluations = 0;
    const result = await runMainNarrativeAttempts({
      maxAttempts: 2,
      request: async ({ attempt }) => `response-${attempt}`,
      evaluate: async (value) => {
        evaluations += 1;
        if (evaluations === 1) throw new SyntaxError('malformed narrative json');
        return { status: 'accept' as const, value };
      },
    });

    expect(result).toEqual({ value: 'response-2', attempt: 2 });
  });
});
