import { afterEach, expect, it, vi } from 'vitest';
import { createCourierReplyQueue, type CourierReplyDispatchResult } from '@/hooks/useGame/courierReplyQueue';

afterEach(() => vi.useRealTimers());

it('observes queued, in-flight reveal and failed exchanges until a successful retry', async () => {
  vi.useFakeTimers();
  let finish!: (result: CourierReplyDispatchResult) => void;
  const queue = createCourierReplyQueue({ getSessionId: () => 7, dispatch: () => new Promise(resolve => { finish = resolve; }) });
  const observer = vi.fn();
  const unsubscribe = queue.subscribe(observer);
  queue.enqueue({ conversationId: 'chat', messageId: 'ask', sessionId: 7 });
  expect(queue.isPending('chat')).toBe(true);
  expect(observer).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(500);
  expect(queue.isPending('chat')).toBe(true);
  finish('retry'); await vi.advanceTimersByTimeAsync(0);
  expect(queue.isPending('chat')).toBe(true);
  queue.retry('chat'); await vi.advanceTimersByTimeAsync(0);
  expect(queue.isPending('chat')).toBe(true);
  finish('sent'); await vi.advanceTimersByTimeAsync(0);
  expect(queue.isPending('chat')).toBe(false);
  unsubscribe(); queue.dispose();
});

it('preserves separate failed batch identities when retrying multiple group messages', async () => {
  vi.useFakeTimers();
  const dispatched: string[][] = [];
  const queue = createCourierReplyQueue({
    getSessionId: () => 7,
    dispatch: async (batch) => { dispatched.push(batch.messageIds); return dispatched.length <= 2 ? 'retry' : 'sent'; },
  });
  queue.enqueue({ conversationId: 'group', messageId: 'p1', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(500);
  queue.enqueue({ conversationId: 'group', messageId: 'p2', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(500);
  queue.retry('group');
  await vi.advanceTimersByTimeAsync(0);
  expect(dispatched).toEqual([['p1'], ['p2'], ['p1'], ['p2']]);
  queue.dispose();
});

it('scopes pending checks to the requested exchange without discarding an older failed batch', async () => {
  vi.useFakeTimers();
  const dispatched: string[][] = [];
  let finishNew!: (result: CourierReplyDispatchResult) => void;
  const queue = createCourierReplyQueue({
    getSessionId: () => 7,
    dispatch: async (batch) => {
      dispatched.push(batch.messageIds);
      if (dispatched.length === 1) return 'retry';
      if (batch.messageIds.includes('new')) return new Promise(resolve => { finishNew = resolve; });
      return 'sent';
    },
  });
  try {
    queue.enqueue({ conversationId: 'chat', messageId: 'old', sessionId: 7 });
    await vi.advanceTimersByTimeAsync(500);
    expect(queue.isPending('chat', ['old'])).toBe(true);
    expect(queue.isPending('chat', ['new'])).toBe(false);
    queue.enqueue({ conversationId: 'chat', messageId: 'new', sessionId: 7 });
    expect(queue.isPending('chat', ['new'])).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(queue.isPending('chat', ['new'])).toBe(true);
    finishNew('sent');
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.isPending('chat')).toBe(true);
    expect(queue.isPending('chat', ['old'])).toBe(true);
    expect(queue.isPending('chat', ['new'])).toBe(false);
    queue.retry('chat', ['old']);
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatched).toEqual([['old'], ['new'], ['old']]);
    expect(queue.isPending('chat')).toBe(false);
  } finally { queue.dispose(); }
});

it('keeps all coalesced request identities pending during delivery and ignores them after a save switch', async () => {
  vi.useFakeTimers();
  let sessionId = 7;
  let finish!: (result: CourierReplyDispatchResult) => void;
  const queue = createCourierReplyQueue({ getSessionId: () => sessionId, dispatch: () => new Promise(resolve => { finish = resolve; }) });
  try {
    queue.enqueue({ conversationId: 'chat', messageId: 'one', sessionId: 7 });
    queue.enqueue({ conversationId: 'chat', messageId: 'two', sessionId: 7 });
    await vi.advanceTimersByTimeAsync(500);
    expect(queue.isPending('chat', ['one'])).toBe(true);
    expect(queue.isPending('chat', ['two'])).toBe(true);
    expect(queue.isPending('chat', ['unrelated'])).toBe(false);
    expect(queue.isPending('another', ['one'])).toBe(false);
    sessionId = 8;
    expect(queue.isPending('chat', ['one'])).toBe(false);
    queue.invalidateSession();
    finish('sent');
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.isPending('chat', ['two'])).toBe(false);
  } finally { queue.dispose(); }
});

it('coalesces consecutive sends in one conversation after 500 milliseconds of silence', async () => {
  vi.useFakeTimers();
  const dispatched: string[][] = [];
  const queue = createCourierReplyQueue({
    getSessionId: () => 7,
    dispatch: async (batch) => { dispatched.push(batch.messageIds); return 'sent'; },
  });
  queue.enqueue({ conversationId: 'amber', messageId: 'p1', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(300);
  queue.enqueue({ conversationId: 'amber', messageId: 'p2', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(300);
  queue.enqueue({ conversationId: 'amber', messageId: 'p3', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(499);
  expect(dispatched).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(dispatched).toEqual([['p1', 'p2', 'p3']]);
  queue.dispose();
});

it('keeps a newly sent message out of a request already in flight', async () => {
  vi.useFakeTimers();
  let finishFirst: ((result: CourierReplyDispatchResult) => void) | undefined;
  const first = new Promise<CourierReplyDispatchResult>((resolve) => { finishFirst = resolve; });
  const dispatched: string[][] = [];
  const queue = createCourierReplyQueue({
    getSessionId: () => 7,
    dispatch: (batch) => { dispatched.push(batch.messageIds); return dispatched.length === 1 ? first : Promise.resolve('sent'); },
  });
  queue.enqueue({ conversationId: 'amber', messageId: 'p1', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(500);
  queue.enqueue({ conversationId: 'amber', messageId: 'p2', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(500);
  expect(dispatched).toEqual([['p1']]);
  finishFirst?.('sent');
  await vi.advanceTimersByTimeAsync(0);
  expect(dispatched).toEqual([['p1'], ['p2']]);
  queue.dispose();
});

it('lets another ready conversation proceed after the active one settles', async () => {
  vi.useFakeTimers();
  let finishFirst: ((result: CourierReplyDispatchResult) => void) | undefined;
  const first = new Promise<CourierReplyDispatchResult>((resolve) => { finishFirst = resolve; });
  const dispatched: string[] = [];
  const queue = createCourierReplyQueue({
    getSessionId: () => 7,
    dispatch: (batch) => { dispatched.push(batch.conversationId); return dispatched.length === 1 ? first : Promise.resolve('sent'); },
  });
  queue.enqueue({ conversationId: 'amber', messageId: 'p1', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(100);
  queue.enqueue({ conversationId: 'lisa', messageId: 'p2', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(500);
  expect(dispatched).toEqual(['amber']);
  finishFirst?.('sent');
  await vi.advanceTimersByTimeAsync(0);
  expect(dispatched).toEqual(['amber', 'lisa']);
  queue.dispose();
});

it('holds model failure for explicit retry but automatically defers a transient claim collision', async () => {
  vi.useFakeTimers();
  const dispatched: string[][] = [];
  const outcomes: CourierReplyDispatchResult[] = ['retry', 'defer', 'sent'];
  const queue = createCourierReplyQueue({
    getSessionId: () => 7,
    dispatch: async (batch) => { dispatched.push(batch.messageIds); return outcomes.shift() ?? 'sent'; },
  });
  queue.enqueue({ conversationId: 'amber', messageId: 'p1', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(2000);
  expect(dispatched).toEqual([['p1']]);
  queue.retry('amber');
  await vi.advanceTimersByTimeAsync(0);
  expect(dispatched).toEqual([['p1'], ['p1']]);
  await vi.advanceTimersByTimeAsync(500);
  expect(dispatched).toEqual([['p1'], ['p1'], ['p1']]);
  queue.dispose();
});

/**
 * 2026-09-29 回归（用户报的第 8 项）：一次模型失败会把会话标成 failed，旧实现 `enqueue` 里
 * `if (!entry.failed) schedule(...)` 于是**之后的新消息永远不再自动派发** —— 界面横幅一直挂着，
 * 此后同一会话的每条消息都「没有回信」，玩家只能看到「回信失败，消息已保留。请稍后重试。」。
 * 现在：新消息照常自动派发；失败的那一批仍留给手动重试，且重试只重发失败批次。
 */
it('still auto-dispatches new messages after a failed batch, and retry only resends the failed ones', async () => {
  vi.useFakeTimers();
  const dispatched: string[][] = [];
  const queue = createCourierReplyQueue({
    getSessionId: () => 7,
    dispatch: async (batch) => { dispatched.push(batch.messageIds); return dispatched.length === 1 ? 'retry' : 'sent'; },
  });
  queue.enqueue({ conversationId: 'amber', messageId: 'p1', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(500);
  expect(dispatched).toEqual([['p1']]);
  queue.enqueue({ conversationId: 'amber', messageId: 'p2', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(500);
  expect(dispatched).toEqual([['p1'], ['p2']]);
  queue.retry('amber');
  await vi.advanceTimersByTimeAsync(0);
  expect(dispatched).toEqual([['p1'], ['p2'], ['p1']]);
  queue.dispose();
});

/**
 * B15（PROJECT_AUDIT_2026-10-03）：p1 在途时发 p2，p1 失败会清掉 p2 已到期的调度；
 * 手动重试 p1 之后 p2 仍然不发。修法：失败只把**这一批**标成待手动重试，
 * 期间新到达的消息保留自己的调度窗口。
 */
it('keeps a newly sent message scheduled when an earlier batch fails, and still sends it after a manual retry', async () => {
  vi.useFakeTimers();
  const dispatched: string[][] = [];
  let finishFirst: ((result: CourierReplyDispatchResult) => void) | undefined;
  const first = new Promise<CourierReplyDispatchResult>((resolve) => { finishFirst = resolve; });
  const queue = createCourierReplyQueue({
    getSessionId: () => 7,
    dispatch: (batch) => {
      dispatched.push(batch.messageIds);
      return dispatched.length === 1 ? first : Promise.resolve('sent');
    },
  });
  queue.enqueue({ conversationId: 'amber', messageId: 'p1', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(500);
  queue.enqueue({ conversationId: 'amber', messageId: 'p2', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(500);
  expect(dispatched).toEqual([['p1']]);
  finishFirst?.('retry');
  await vi.advanceTimersByTimeAsync(500);
  expect(dispatched).toEqual([['p1'], ['p2']]);
  queue.retry('amber');
  await vi.advanceTimersByTimeAsync(0);
  expect(dispatched).toEqual([['p1'], ['p2'], ['p1']]);
  queue.dispose();
});

it('discards old-session timers and never starts a disposed queue', async () => {
  vi.useFakeTimers();
  let sessionId = 7;
  const dispatched: string[] = [];
  const queue = createCourierReplyQueue({
    getSessionId: () => sessionId,
    dispatch: async (batch) => { dispatched.push(batch.conversationId); return 'sent'; },
  });
  queue.enqueue({ conversationId: 'amber', messageId: 'p1', sessionId: 7 });
  sessionId = 8;
  await vi.advanceTimersByTimeAsync(500);
  expect(dispatched).toEqual([]);
  queue.enqueue({ conversationId: 'lisa', messageId: 'p2', sessionId: 8 });
  queue.invalidateSession();
  await vi.advanceTimersByTimeAsync(500);
  expect(dispatched).toEqual([]);
  queue.enqueue({ conversationId: 'jean', messageId: 'p3', sessionId: 8 });
  queue.dispose();
  await vi.advanceTimersByTimeAsync(500);
  expect(dispatched).toEqual([]);
});

it('accepts sends after StrictMode replays the queue effect cleanup and setup', async () => {
  vi.useFakeTimers();
  const dispatched: string[] = [];
  const queue = createCourierReplyQueue({
    getSessionId: () => 7,
    dispatch: async (batch) => { dispatched.push(batch.conversationId); return 'sent'; },
  });
  queue.activate();
  queue.dispose(); // React StrictMode's development-only effect cleanup.
  queue.activate(); // The same mounted queue receives the effect setup again.
  queue.enqueue({ conversationId: 'amber', messageId: 'p1', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(500);
  expect(dispatched).toEqual(['amber']);
  queue.dispose();
});

it('lets the new save reply without waiting for an old save model request to finish', async () => {
  vi.useFakeTimers();
  let sessionId = 7;
  let finishOld: ((result: CourierReplyDispatchResult) => void) | undefined;
  const oldRequest = new Promise<CourierReplyDispatchResult>((resolve) => { finishOld = resolve; });
  const dispatched: string[] = [];
  const queue = createCourierReplyQueue({
    getSessionId: () => sessionId,
    dispatch: (batch) => {
      dispatched.push(`${batch.sessionId}:${batch.conversationId}`);
      return batch.sessionId === 7 ? oldRequest : Promise.resolve('sent');
    },
  });
  queue.enqueue({ conversationId: 'amber', messageId: 'old', sessionId: 7 });
  await vi.advanceTimersByTimeAsync(500);
  sessionId = 8;
  queue.invalidateSession();
  queue.enqueue({ conversationId: 'lisa', messageId: 'new', sessionId: 8 });
  await vi.advanceTimersByTimeAsync(500);
  expect(dispatched).toEqual(['7:amber', '8:lisa']);
  finishOld?.('sent');
  await vi.advanceTimersByTimeAsync(0);
  expect(dispatched).toEqual(['7:amber', '8:lisa']);
  queue.dispose();
});
