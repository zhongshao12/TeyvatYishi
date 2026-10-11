import { expect, it, vi } from 'vitest';
import { publishCourierReplyFeedback } from '@/hooks/useGame/courierReplyFeedback';

function effects() {
  return { report: vi.fn(), registerRetry: vi.fn(), resolve: vi.fn(), retry: vi.fn(), toast: vi.fn() };
}

it('registers partial failure for its original batch, with a retry limited to that batch', () => {
  const ports = effects();
  const batch = { conversationId: 'group', messageIds: ['p1'], sessionId: 7 };
  publishCourierReplyFeedback({ batch, replied: 1, failedMemberNames: ['丽莎'], turn: 3 }, ports);
  expect(ports.report).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: 'group:members:p1', humanReason: expect.stringContaining('丽莎') }));
  expect(ports.resolve).not.toHaveBeenCalled();
  ports.registerRetry.mock.calls[0]![1]();
  expect(ports.retry).toHaveBeenCalledWith('group', ['p1']);
});

it('resolves only the successfully retried batch, leaving other batches independent', () => {
  const ports = effects();
  const batch = { conversationId: 'group', messageIds: ['p2'], sessionId: 7 };
  publishCourierReplyFeedback({ batch, replied: 1, failedMemberNames: [], turn: 4 }, ports);
  expect(ports.resolve).toHaveBeenCalledWith('courier_reply:group:members:p2');
  expect(ports.resolve).toHaveBeenCalledWith('courier_reply:group:messages:p2');
  expect(ports.report).not.toHaveBeenCalled();
  expect(ports.toast).not.toHaveBeenCalled();
});

it('does not resolve a failure when the dispatcher produced no reply', () => {
  const ports = effects();
  publishCourierReplyFeedback({ batch: { conversationId: 'group', messageIds: ['p1'], sessionId: 7 }, replied: 0, turn: 4 }, ports);
  expect(ports.resolve).not.toHaveBeenCalled();
});
