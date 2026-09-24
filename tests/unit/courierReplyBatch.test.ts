import { expect, it } from 'vitest';
import type { CourierConversation, CourierMessage } from '@/models/teyvat/courier';
import { buildCourierPlayerBatch, createCourierPlayerMessageId } from '@/utils/courierReplyBatch';

const player = (id: string, content: string): CourierMessage => ({
  id, senderId: 'player', senderName: '旅人', role: 'user', content,
  turn: 1, timestamp: 1, readBy: ['player'],
});
const conversation: CourierConversation = {
  id: 'amber', title: '安柏', participantIds: ['player', 'amber'], type: 'private',
  messages: [player('p1', '第一句'), player('p2', '第二句')], unread: 0,
  typingMemberIds: [], updatedAt: 1,
};

it('keeps two player sends unique even when they share a clock tick', () => {
  expect(createCourierPlayerMessageId()).not.toBe(createCourierPlayerMessageId());
});

it('combines requested player messages in conversation order without mutating the conversation', () => {
  const result = buildCourierPlayerBatch(conversation, ['p2', 'p1', 'p2']);
  expect(result?.id).toBe('p2');
  expect(result?.content).toBe('1. 第一句\n2. 第二句');
  expect(conversation.messages.map((message) => message.content)).toEqual(['第一句', '第二句']);
});

it('refuses an incomplete or non-player batch instead of answering only part', () => {
  const withContact: CourierConversation = {
    ...conversation,
    messages: [...conversation.messages, {
      id: 'amber-reply', senderId: 'amber', senderName: '安柏', role: 'contact',
      content: '收到', turn: 1, timestamp: 2, readBy: [],
    }],
  };
  expect(buildCourierPlayerBatch(withContact, ['p1', 'missing'])).toBeNull();
  expect(buildCourierPlayerBatch(withContact, ['p1', 'amber-reply'])).toBeNull();
  expect(buildCourierPlayerBatch(withContact, [])).toBeNull();
  expect(buildCourierPlayerBatch({ ...withContact, messages: [player('blank', '  ')] }, ['blank'])).toBeNull();
});
