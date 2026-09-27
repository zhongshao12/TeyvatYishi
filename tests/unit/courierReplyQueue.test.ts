import { afterEach, expect, it, vi } from 'vitest';
import { createCourierReplyQueue, type CourierReplyDispatchResult } from '@/hooks/useGame/courierReplyQueue';

afterEach(() => vi.useRealTimers());

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
