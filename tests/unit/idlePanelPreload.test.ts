// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preloadAll } from '@/utils/lazyWithRetry';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('idle panel warming', () => {
  it('loads at most one panel per idle turn, waiting for its import before scheduling another', async () => {
    const callbacks = new Map<number, IdleRequestCallback>(); let id = 0;
    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => { callbacks.set(++id, callback); return id; });
    vi.stubGlobal('cancelIdleCallback', (key: number) => { callbacks.delete(key); });
    let finish!: () => void;
    const first = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const second = vi.fn(async () => {});
    const cancel = preloadAll([{ preload: first }, { preload: second }]);
    callbacks.get(1)!({ didTimeout: false, timeRemaining: () => 5 }); callbacks.delete(1);
    await Promise.resolve();
    expect(first).toHaveBeenCalledTimes(1); expect(second).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(0);
    finish(); await new Promise(resolve => setTimeout(resolve, 0));
    expect(callbacks.size).toBe(1);
    cancel(); expect(callbacks.size).toBe(0); expect(second).not.toHaveBeenCalled();
  });
  it('cancels the timer fallback before importing and continues after a rejected import', async () => {
    vi.stubGlobal('requestIdleCallback', undefined); vi.useFakeTimers();
    const first = vi.fn(async () => { throw new Error('offline'); }); const second = vi.fn(async () => {});
    const cancel = preloadAll([{ preload: first }]); cancel(); await vi.runAllTimersAsync();
    expect(first).not.toHaveBeenCalled();
    const stop = preloadAll([{ preload: first }, { preload: second }]); await vi.runAllTimersAsync(); stop();
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
  });
});
