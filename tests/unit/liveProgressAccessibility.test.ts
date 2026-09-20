// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatList } from '@/components/features/Chat/ChatList';
import { InputArea } from '@/components/features/Chat/InputArea';
import { setStreamingMessage } from '@/utils/streamingMessageStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('live progress announcements', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    setStreamingMessage('');
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exposes a polite, busy live region while a turn is pending', async () => {
    const scrollRef = createRef<HTMLDivElement>();
    await act(async () => {
      root.render(createElement(ChatList, { messages: [], loading: true, scrollRef }));
    });

    const live = host.querySelector<HTMLElement>('[data-testid="chat-live-status"]');
    expect(live).not.toBeNull();
    expect(live?.getAttribute('role')).toBe('status');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.getAttribute('aria-busy')).toBe('true');
    expect(live?.textContent).toContain('正在');
  });

  it('marks progress areas idle once the turn settles', async () => {
    const scrollRef = createRef<HTMLDivElement>();
    await act(async () => {
      root.render(createElement(ChatList, { messages: [], loading: false, scrollRef }));
    });

    const live = host.querySelector<HTMLElement>('[data-testid="chat-live-status"]');
    expect(live?.getAttribute('aria-busy')).toBe('false');
  });

  it('announces a throttled byte count for streaming text instead of every chunk', async () => {
    const scrollRef = createRef<HTMLDivElement>();
    await act(async () => {
      root.render(createElement(ChatList, { messages: [], loading: true, scrollRef }));
    });

    const live = host.querySelector<HTMLElement>('[data-testid="chat-live-status"]')!;
    const streamed = '正文'.repeat(500);

    await act(async () => {
      setStreamingMessage('正');
    });
    const firstAnnouncement = live.textContent;

    // 同一节流桶内的增量更新不得改变播报文本（否则读屏会被逐 chunk 刷屏）。
    await act(async () => {
      setStreamingMessage('正文');
    });
    expect(live.textContent).toBe(firstAnnouncement);

    await act(async () => {
      setStreamingMessage(streamed);
    });
    expect(live.textContent).not.toBe(firstAnnouncement);
    expect(live.textContent).not.toContain(streamed);
    expect(live.textContent?.length).toBeLessThan(80);
  });

  it('marks the streaming body and the visible loading indicator as busy', async () => {
    const scrollRef = createRef<HTMLDivElement>();
    await act(async () => {
      root.render(createElement(ChatList, { messages: [], loading: true, scrollRef }));
    });
    const pendingIndicator = host.querySelector<HTMLElement>('[data-testid="chat-loading-indicator"]');
    expect(pendingIndicator?.getAttribute('aria-busy')).toBe('true');

    await act(async () => {
      setStreamingMessage('{ "body": ["夜色降临。"] }');
    });
    const preview = host.querySelector<HTMLElement>('[data-testid="chat-streaming-preview"]');
    expect(preview).not.toBeNull();
    expect(preview?.getAttribute('aria-busy')).toBe('true');
  });

  it('exposes the background workflow hint as a polite live region with busy state', async () => {
    const render = (status: 'searching' | 'done') => createElement(InputArea, {
      onSend: vi.fn(),
      onAbort: vi.fn(),
      loading: true,
      workflowHint: '正在检索世界书……',
      workflowStatus: status,
      onCancelWorkflow: vi.fn(),
    });

    await act(async () => { root.render(render('searching')); });
    const hint = host.querySelector<HTMLElement>('[data-testid="workflow-hint-live"]');
    expect(hint).not.toBeNull();
    expect(hint?.getAttribute('role')).toBe('status');
    expect(hint?.getAttribute('aria-live')).toBe('polite');
    expect(hint?.getAttribute('aria-busy')).toBe('true');

    await act(async () => { root.render(render('done')); });
    expect(host.querySelector<HTMLElement>('[data-testid="workflow-hint-live"]')?.getAttribute('aria-busy')).toBe('false');
  });

  it('keeps the cancel button reachable while loading even without a workflow hint', async () => {
    const onCancelWorkflow = vi.fn();
    await act(async () => {
      root.render(createElement(InputArea, {
        onSend: vi.fn(),
        onAbort: vi.fn(),
        loading: true,
        workflowHint: '',
        workflowStatus: '',
        onCancelWorkflow,
      }));
    });

    const cancel = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === '取消');
    expect(cancel).toBeTruthy();
    await act(async () => cancel!.click());
    expect(onCancelWorkflow).toHaveBeenCalledTimes(1);
  });
});
