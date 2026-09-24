import { afterEach, expect, it } from 'vitest';
import { beginCourierReply, endCourierReply, isCourierReplyInFlight } from '@/services/ai/courierService';

afterEach(() => {
  endCourierReply('same-conversation', 1);
  endCourierReply('same-conversation', 2);
  endCourierReply('legacy-conversation');
});

it('lets a new save claim the same conversation while an old request is still pending', () => {
  expect(beginCourierReply('same-conversation', 1)).toBe(true);
  expect(beginCourierReply('same-conversation', 1)).toBe(false);
  expect(beginCourierReply('same-conversation', 2)).toBe(true);
  expect(beginCourierReply('same-conversation', 1)).toBe(false);
  endCourierReply('same-conversation', 1);
  expect(isCourierReplyInFlight('same-conversation')).toBe(true);
  expect(beginCourierReply('same-conversation', 2)).toBe(false);
  endCourierReply('same-conversation', 2);
  expect(isCourierReplyInFlight('same-conversation')).toBe(false);
});

it('keeps the legacy unscoped claim behavior for existing callers', () => {
  expect(beginCourierReply('legacy-conversation')).toBe(true);
  expect(beginCourierReply('legacy-conversation')).toBe(false);
  endCourierReply('legacy-conversation');
  expect(beginCourierReply('legacy-conversation')).toBe(true);
});
