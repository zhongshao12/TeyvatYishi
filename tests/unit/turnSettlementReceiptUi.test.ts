// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { 聊天消息 } from '@/models/chat';
import type { 变量命令批次 } from '@/models/variableCommand';
import { ChatList } from '@/components/features/Chat/ChatList';
import { TurnSettlementReceipt } from '@/components/features/Chat/TurnSettlementReceipt';
import { setStreamingMessage } from '@/utils/streamingMessageStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const receipt = {
  turn: 3,
  summary: '1 项变化，1 条警告，0 项失败',
  items: [
    { status: 'success' as const, label: '背包增加 1' },
    { status: 'warning' as const, label: '物品归属不明' },
  ],
};

const assistant: 聊天消息 = {
  id: 'assistant-3', role: 'assistant', content: '正式正文', timestamp: 2, gameTime: '3',
  parsedResponse: { body: [{ kind: 'narration', text: '正式正文' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } },
};
const batch: 变量命令批次 = {
  id: 'batch-3', turn: 3, timestamp: 3, source: 'main',
  results: [{ command: { action: 'add', key: '背包.物品[0].数量', value: 1 }, ok: true }],
};

describe('TurnSettlementReceipt UI', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); setStreamingMessage(''); });
    host.remove();
    vi.restoreAllMocks();
  });

  it('starts collapsed with a readable summary and text labels for diagnostics', async () => {
    const markup = renderToStaticMarkup(createElement(TurnSettlementReceipt, { receipt }));
    expect(markup).toContain('本回合变化');
    expect(markup).toContain('1 条警告');
    expect(markup).not.toContain('SECRET_API_KEY');

    await act(async () => root.render(createElement(TurnSettlementReceipt, { receipt })));
    const details = host.querySelector('details');
    const summary = host.querySelector('summary');
    expect(details?.open).toBe(false);
    expect(summary?.textContent).toContain('本回合变化');
    expect(host.textContent).toContain('警告');
    await act(async () => summary?.click());
    expect(details?.open).toBe(true);
    expect(host.textContent).toContain('背包增加 1');
    expect(host.textContent).toContain('物品归属不明');
  });

  it('only attaches persisted results to a formal assistant turn, never user or stream', async () => {
    const user: 聊天消息 = { id: 'user-3', role: 'user', content: '继续', timestamp: 1, gameTime: '3' };
    const scrollRef = createRef<HTMLDivElement>();
    await act(async () => root.render(createElement(ChatList, { messages: [user], variableBatches: [batch], loading: false, scrollRef })));
    expect(host.textContent).not.toContain('本回合变化');

    await act(async () => {
      setStreamingMessage('生成中');
      root.render(createElement(ChatList, { messages: [user], variableBatches: [batch], loading: true, scrollRef }));
    });
    expect(host.querySelector('[data-testid="chat-streaming-preview"]')).not.toBeNull();
    expect(host.textContent).not.toContain('本回合变化');

    await act(async () => root.render(createElement(ChatList, { messages: [user, assistant], variableBatches: [], loading: false, scrollRef })));
    expect(host.textContent).not.toContain('本回合变化');

    await act(async () => root.render(createElement(ChatList, { messages: [user, assistant], variableBatches: [batch], loading: false, scrollRef })));
    expect(host.textContent?.match(/本回合变化/g)).toHaveLength(1);
    expect(host.textContent).toContain('背包增加 1');
  });
});
