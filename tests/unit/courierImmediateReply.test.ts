import { expect, it } from 'vitest';
import { createEmptyCourierSystem, type CourierConversation, type CourierSystem } from '@/models/teyvat/courier';
import type { API配置项 } from '@/models/settings';
import { runCourierReplyPass } from '@/hooks/useGame/courierBackgroundJobs';
import { buildCourierGroupReplyPrompt, buildCourierReplyPrompt } from '@/services/ai/courierLetterModel';

const config: API配置项 = {
  id: 'test', name: 'test', provider: 'openai_compatible',
  baseUrl: 'https://invalid.example', apiKey: 'unused', model: 'test',
  createdAt: 1, updatedAt: 1,
};
const conversation: CourierConversation = {
  id: 'group', title: '蒙德伙伴', participantIds: ['player', 'amber'],
  type: 'group', unread: 0, typingMemberIds: [], updatedAt: 2,
  messages: [
    { id: 'p1', senderId: 'player', senderName: '旅人', role: 'user', content: '第一句', turn: 2, timestamp: 1, readBy: ['player'] },
    { id: 'p2', senderId: 'player', senderName: '旅人', role: 'user', content: '第二句', turn: 2, timestamp: 2, readBy: ['player'] },
  ],
};
const courier: CourierSystem = {
  ...createEmptyCourierSystem(),
  contacts: [{ id: 'amber', name: '安柏', available: true }],
  conversations: [conversation],
};

it('passes consecutive player messages to one group reply in their original order', async () => {
  const seen: string[] = [];
  const result = await runCourierReplyPass({
    courier, npcs: [], letterApiConfig: config, turn: 2,
    replyBatch: { conversationId: 'group', messageIds: ['p1', 'p2'] },
    fallbackPolicy: 'error',
    groupReplyGenerator: async (_config, context) => {
      seen.push(context.playerMessage.content);
      return '收到，我会认真想想。';
    },
  });
  expect(seen).toEqual(['1. 第一句\n2. 第二句']);
  expect(result.replied).toBe(1);
  expect(result.courier.conversations[0]?.messages).toHaveLength(3);
  expect(courier.conversations[0]?.messages).toHaveLength(2);
});

it('answers an explicit pending batch even when a newer contact bubble follows it', async () => {
  const withLaterReply: CourierSystem = {
    ...courier,
    conversations: [{ ...conversation, messages: [...conversation.messages, {
      id: 'old-contact', senderId: 'amber', senderName: '安柏', role: 'contact',
      content: '我刚看见上一条。', turn: 2, timestamp: 3, readBy: [],
    }] }],
  };
  const result = await runCourierReplyPass({
    courier: withLaterReply, npcs: [], letterApiConfig: config, turn: 2,
    replyBatch: { conversationId: 'group', messageIds: ['p2'] }, fallbackPolicy: 'error',
    groupReplyGenerator: async () => '这条也看到了。',
  });
  expect(result.replied).toBe(1);
  expect(result.courier.conversations[0]?.messages.at(-1)?.content).toBe('这条也看到了。');
});

it('does not invent a reply when the immediate-reply API is unavailable', async () => {
  await expect(runCourierReplyPass({
    courier, npcs: [], letterApiConfig: null, turn: 2,
    replyBatch: { conversationId: 'group', messageIds: ['p1'] }, fallbackPolicy: 'error',
  })).rejects.toThrow('PHONE_REPLY_API_UNAVAILABLE');
  expect(courier.conversations[0]?.messages).toHaveLength(2);
});

it('rejects an incomplete batch and preserves the input after a model failure', async () => {
  await expect(runCourierReplyPass({
    courier, npcs: [], letterApiConfig: config, turn: 2,
    replyBatch: { conversationId: 'group', messageIds: ['p1', 'missing'] }, fallbackPolicy: 'error',
    groupReplyGenerator: async () => '不会执行',
  })).rejects.toThrow('PHONE_REPLY_BATCH_STALE');
  await expect(runCourierReplyPass({
    courier, npcs: [], letterApiConfig: config, turn: 2,
    replyBatch: { conversationId: 'group', messageIds: ['p1'] }, fallbackPolicy: 'error',
    groupReplyGenerator: async () => { throw new Error('MODEL_DOWN'); },
  })).rejects.toThrow('MODEL_DOWN');
  expect(courier.conversations[0]?.messages).toHaveLength(2);
});

it('instructs the model to answer consecutive messages as one exchange', () => {
  const playerMessage = { ...conversation.messages[1]!, content: '1. 第一句\n2. 第二句' };
  const groupPrompt = buildCourierGroupReplyPrompt({ conversation, playerMessage });
  const privatePrompt = buildCourierReplyPrompt({ conversation: { ...conversation, type: 'private' }, playerMessage });
  for (const prompt of [groupPrompt, privatePrompt]) {
    expect(prompt).toContain('1. 第一句\n2. 第二句');
    expect(prompt).toContain('按顺序回应');
  }
});

it('still recognizes a consecutive batch when the first player message contains a line break', () => {
  const playerMessage = { ...conversation.messages[1]!, content: '1. 第一行\n补充说明\n2. 第二句' };
  expect(buildCourierGroupReplyPrompt({ conversation, playerMessage })).toContain('按顺序回应');
  expect(buildCourierReplyPrompt({ conversation: { ...conversation, type: 'private' }, playerMessage })).toContain('按顺序回应');
});
