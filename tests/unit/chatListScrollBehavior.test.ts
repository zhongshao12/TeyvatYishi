// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatList } from '@/components/features/Chat/ChatList';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ChatList scroll behavior', () => {
  let host: HTMLDivElement;
  let root: Root;
  let animationFrames: FrameRequestCallback[];
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    animationFrames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('coalesces repeated scroll events into one frame and shows the return control off-bottom', async () => {
    const scrollRef = createRef<HTMLDivElement>();
    await act(async () => {
      root.render(createElement(ChatList, { messages: [], loading: false, scrollRef }));
    });
    expect(scrollRef.current).not.toBeNull();
    Object.defineProperties(scrollRef.current!, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, writable: true, value: 100 },
    });

    await act(async () => {
      scrollRef.current!.dispatchEvent(new Event('scroll', { bubbles: true }));
      scrollRef.current!.dispatchEvent(new Event('scroll', { bubbles: true }));
      scrollRef.current!.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(animationFrames).toHaveLength(1);

    await act(async () => animationFrames.shift()?.(0));
    const returnButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('回到底部'));
    expect(returnButton).toBeTruthy();

    await act(async () => returnButton?.click());
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'end' });
    expect(host.textContent).not.toContain('回到底部');
  });

  it('cancels pending scroll measurement when unmounted', async () => {
    const scrollRef = createRef<HTMLDivElement>();
    await act(async () => {
      root.render(createElement(ChatList, { messages: [], loading: false, scrollRef }));
    });
    await act(async () => {
      scrollRef.current!.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect(animationFrames).toHaveLength(1);

    await act(async () => root.unmount());
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    root = createRoot(host);
  });
});
