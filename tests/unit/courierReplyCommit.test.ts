import { expect, it } from 'vitest';
import { createEmptyCourierSystem, type CourierMessage, type CourierSystem } from '@/models/teyvat/courier';
import { applyCourierReplyMessageIfLive, isCourierReplyTargetLive } from '@/utils/courierReplyCommit';

const reply: CourierMessage = {
  id: 'reply-p1', senderId: 'amber', senderName: '安柏', role: 'contact',
  content: '我看到了。', turn: 2, timestamp: 3, readBy: [],
};
const live: CourierSystem = {
  ...createEmptyCourierSystem(),
  conversations: [{
    id: 'amber', title: '安柏', participantIds: ['player', 'amber'], type: 'private',
    messages: [{ id: 'p1', senderId: 'player', senderName: '旅人', role: 'user', content: '你好', turn: 1, timestamp: 1, readBy: ['player'] }],
    unread: 0, typingMemberIds: [], updatedAt: 1,
  }],
};

it('rejects a deleted conversation, system conversation, missing player message, and contact ID', () => {
  expect(isCourierReplyTargetLive(createEmptyCourierSystem(), 'amber', ['p1'])).toBe(false);
  expect(isCourierReplyTargetLive(live, 'amber', ['p1'])).toBe(true);
  expect(isCourierReplyTargetLive(live, 'amber', ['missing'])).toBe(false);
  expect(isCourierReplyTargetLive(live, 'amber', ['p1', 'reply-p1'])).toBe(false);
  expect(isCourierReplyTargetLive({ ...live, conversations: [{ ...live.conversations[0]!, type: 'system' }] }, 'amber', ['p1'])).toBe(false);
});

it('ignores a late reply after a save switch or group deletion', () => {
  expect(applyCourierReplyMessageIfLive({ current: live, currentSessionId: 8, expectedSessionId: 7, conversationId: 'amber', messageIds: ['p1'], message: reply })).toBe(live);
  const deleted = createEmptyCourierSystem();
  expect(applyCourierReplyMessageIfLive({ current: deleted, currentSessionId: 7, expectedSessionId: 7, conversationId: 'amber', messageIds: ['p1'], message: reply })).toBe(deleted);
  const appended = applyCourierReplyMessageIfLive({ current: live, currentSessionId: 7, expectedSessionId: 7, conversationId: 'amber', messageIds: ['p1'], message: reply });
  expect(appended.conversations[0]?.messages.map((message) => message.id)).toEqual(['p1', 'reply-p1']);
  expect(applyCourierReplyMessageIfLive({ current: appended, currentSessionId: 7, expectedSessionId: 7, conversationId: 'amber', messageIds: ['p1'], message: reply }).conversations[0]?.messages).toHaveLength(2);
});
