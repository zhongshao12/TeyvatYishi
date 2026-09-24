// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedCourierAutosave } from '@/hooks/useGame/useDebouncedCourierAutosave';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('out-of-turn courier autosave', () => {
  let host: HTMLDivElement;
  let root: Root;
  let saved: number[];

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    saved = [];
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  function Harness({ value, sessionId, active = true }: { value: number; sessionId: number; active?: boolean }) {
    useDebouncedCourierAutosave({
      value, sessionId, active, enabled: true, delayMs: 100,
      save: async (current) => { saved.push(current); return true; },
      onError: () => undefined,
    });
    return null;
  }

  it('saves a phone change only after the debounce window', async () => {
    await act(async () => root.render(createElement(Harness, { value: 0, sessionId: 1 })));
    await act(async () => root.render(createElement(Harness, { value: 1, sessionId: 1 })));
    await act(async () => vi.advanceTimersByTimeAsync(99));
    expect(saved).toEqual([]);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(saved).toEqual([1]);
  });

  it('warns before closing the page while a phone change is still unsaved', async () => {
    await act(async () => root.render(createElement(Harness, { value: 0, sessionId: 1 })));
    await act(async () => root.render(createElement(Harness, { value: 1, sessionId: 1 })));
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('discards a pending phone save when the player switches saves', async () => {
    await act(async () => root.render(createElement(Harness, { value: 0, sessionId: 1 })));
    await act(async () => root.render(createElement(Harness, { value: 1, sessionId: 1 })));
    await act(async () => root.render(createElement(Harness, { value: 8, sessionId: 2 })));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(saved).toEqual([]);
  });

  it('waits until the main workflow is idle before saving a phone change', async () => {
    await act(async () => root.render(createElement(Harness, { value: 0, sessionId: 1 })));
    await act(async () => root.render(createElement(Harness, { value: 1, sessionId: 1, active: false })));
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(saved).toEqual([]);
    await act(async () => root.render(createElement(Harness, { value: 1, sessionId: 1, active: true })));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(saved).toEqual([1]);
  });

  it('retries a stale checkpoint so an unrelated state change does not strand phone edits', async () => {
    let attempts = 0;
    function RetryHarness({ value }: { value: number }) {
      useDebouncedCourierAutosave({
        value, sessionId: 1, active: true, enabled: true, delayMs: 100,
        save: async (current) => { saved.push(current); attempts += 1; return attempts > 1; },
        onError: () => undefined,
      });
      return null;
    }
    await act(async () => root.render(createElement(RetryHarness, { value: 0 })));
    await act(async () => root.render(createElement(RetryHarness, { value: 1 })));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(saved).toEqual([1, 1]);
  });
});
