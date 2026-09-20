import { describe, expect, it, vi } from 'vitest';
import { assertNotAborted, yieldToMainThread } from '@/utils/asyncControl';

describe('shared async control', () => {
  it('throws the signal reason or the supplied fallback message', () => {
    const withReason = new AbortController();
    withReason.abort(new Error('停止远征'));
    expect(() => assertNotAborted(withReason.signal)).toThrow('停止远征');

    const withoutReason = { aborted: true, reason: undefined } as AbortSignal;
    expect(() => assertNotAborted(withoutReason, '云备份已取消')).toThrow('云备份已取消');
  });

  it('yields through a zero-delay task', async () => {
    vi.useFakeTimers();
    let resumed = false;
    const pending = yieldToMainThread().then(() => { resumed = true; });
    expect(resumed).toBe(false);
    await vi.runAllTimersAsync();
    await pending;
    expect(resumed).toBe(true);
    vi.useRealTimers();
  });
});
