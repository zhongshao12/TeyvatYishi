// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatList } from '@/components/features/Chat/ChatList';
import { setStreamingMessage } from '@/utils/streamingMessageStore';
import type { 聊天消息 } from '@/models/chat';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

it('shows the stream only until its formal assistant reply is present', async () => {
  const user: 聊天消息 = { id: 'u-2', role: 'user', content: '继续', timestamp: 1, gameTime: '2' };
  const assistant: 聊天消息 = {
    id: 'a-2', role: 'assistant', content: '正式正文', timestamp: 2, gameTime: '2',
    parsedResponse: { body: [{ kind: 'narration', text: '正式正文' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } },
  };
  const scrollRef = createRef<HTMLDivElement>();

  await act(async () => {
    setStreamingMessage('正在生成');
    root.render(createElement(ChatList, { messages: [user], loading: true, scrollRef }));
  });
  expect(host.querySelector('[data-testid="chat-streaming-preview"]')).not.toBeNull();

  await act(async () => {
    setStreamingMessage('旧的流式正文');
    root.render(createElement(ChatList, { messages: [user, assistant], loading: true, scrollRef }));
  });
  expect(host.textContent).toContain('正式正文');
  expect(host.querySelector('[data-testid="chat-streaming-preview"]')).toBeNull();

  await act(async () => {
    root.render(createElement(ChatList, { messages: [user, assistant], loading: false, scrollRef }));
  });
  expect(host.querySelector('[data-testid="chat-streaming-preview"]')).toBeNull();
});
