import { expect, it, vi } from 'vitest';
import { createCourierReplyQueue, classifyCourierReplyResult } from '@/hooks/useGame/courierReplyQueue';
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

it('does not inherit a different batch manifest when player IDs share a prefix', async () => {
  const olderPlayer = { ...conversation.messages[0]!, id: 'p1_extra' };
  const seen: string[] = [];
  const result = await runCourierReplyPass({ courier: { ...courier, conversations: [{ ...conversation, messages: [olderPlayer,
    { ...olderPlayer, id: 'courier_group_reply_p1_extra_amber', senderId: 'amber', role: 'contact', replyToMessageIds: ['p1_extra'], expectedReplyIds: ['courier_group_reply_p1_extra_amber'] },
    conversation.messages[0]!,
  ] }] }, npcs: [], letterApiConfig: config, turn: 2, replyBatch: { conversationId: 'group', messageIds: ['p1'] }, fallbackPolicy: 'error',
    groupReplyGenerator: async (_config, context) => { seen.push(context.sender?.name ?? ''); return '收到。'; } });
  expect(seen).toEqual(['安柏']);
  expect(result.courier.conversations[0]?.messages.at(-1)?.expectedReplyIds).toEqual(['courier_group_reply_p1_amber']);
});

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
  expect(result.courier.conversations[0]?.messages[2]?.replyToMessageIds).toEqual(['p1', 'p2']);
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

const multiMemberConversation: CourierConversation = {
  id: 'group-of-three', title: '蒙德小队', participantIds: ['player', 'amber', 'lisa', 'kaeya'],
  type: 'group', unread: 0, typingMemberIds: [], updatedAt: 2,
  messages: [{
    id: 'q1', senderId: 'player', senderName: '旅人', role: 'user',
    content: '@全体成员 出发了', turn: 2, timestamp: 1, readBy: ['player'],
  }],
};
const multiMemberCourier: CourierSystem = {
  ...createEmptyCourierSystem(),
  contacts: [
    { id: 'amber', name: '安柏', available: true },
    { id: 'lisa', name: '丽莎', available: true },
    { id: 'kaeya', name: '凯亚', available: true },
  ],
  conversations: [multiMemberConversation],
};

it('manually retries only failed group members without duplicating delivered replies', async () => {
  vi.useFakeTimers();
  let live = multiMemberCourier;
  let attempts = 0;
  let failedName = '';
  const retryNames: string[] = [];
  const queue = createCourierReplyQueue({
    getSessionId: () => 1,
    dispatch: async (batch) => {
      attempts += 1;
      const result = await runCourierReplyPass({
        courier: live, npcs: [], letterApiConfig: config, turn: 2, replyBatch: batch,
        fallbackPolicy: 'error',
        groupReplyGenerator: async (_config, context) => {
          const name = context.sender?.name ?? '';
          if (attempts === 1 && name === '丽莎') { failedName = name; throw new Error('MODEL_DOWN'); }
          if (attempts > 1) retryNames.push(name);
          return '收到。';
        },
      });
      live = result.courier;
      return classifyCourierReplyResult(result);
    },
  });
  try {
    queue.enqueue({ conversationId: 'group-of-three', messageId: 'q1', sessionId: 1 });
    await vi.advanceTimersByTimeAsync(500);
    expect(failedName).toBe('丽莎');
    expect(live.conversations[0]?.messages.filter((message) => message.role === 'contact')).toHaveLength(2);
    queue.retry('group-of-three');
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(2);
    expect(retryNames).toEqual(['丽莎']);
    const replies = live.conversations[0]?.messages.filter((message) => message.role === 'contact') ?? [];
    expect(replies).toHaveLength(3);
    expect(new Set(replies.map((message) => message.id)).size).toBe(3);
  } finally {
    queue.dispose();
    vi.useRealTimers();
  }
});

/**
 * 2026-09-29 回归：`@全体成员` 会把一次请求放大成「全群人数次」串行模型调用，
 * 旧实现是「全或无 + fail-fast」——任何一位成员失败就整批抛出、已成功的回复一并丢弃，
 * 于是玩家看到「回信失败，消息已保留。请稍后重试。」（这就是用户报的第 8 项）。
 * 现在改为成员级隔离：只有**全员失败**才抛。
 */
it('keeps the other members replies when one group member fails', async () => {
  let calls = 0;
  /** 成员顺序由 `selectGroupReplyMembers` 的稳定打乱决定，所以记下实际被调用的人再断言。 */
  const askedNames: string[] = [];
  const result = await runCourierReplyPass({
    courier: multiMemberCourier, npcs: [], letterApiConfig: config, turn: 2,
    replyBatch: { conversationId: 'group-of-three', messageIds: ['q1'] },
    fallbackPolicy: 'error',
    groupReplyGenerator: async (_config, context) => {
      calls += 1;
      askedNames.push(context.sender?.name?.trim() || `member${calls}`);
      if (calls === 2) throw new Error('MODEL_DOWN');
      return '收到。';
    },
  });
  const replies = result.courier.conversations[0]?.messages.filter((message) => message.role === 'contact') ?? [];
  expect(result.replied).toBe(1);
  expect(replies).toHaveLength(2);
  expect(replies.every((message) => message.content === '收到。')).toBe(true);
  // U04（PROJECT_AUDIT_2026-10-03）：部分成功必须报出「谁没回」，否则玩家会以为角色故意不理人。
  expect(result.failedMemberNames ?? [])!.toEqual([askedNames[1]]);
  // 输入对象不得被就地修改（其它调用方仍持有同一份快照）。
  expect(multiMemberCourier.conversations[0]?.messages).toHaveLength(1);
});

it('still rejects when every group member fails', async () => {
  await expect(runCourierReplyPass({
    courier: multiMemberCourier, npcs: [], letterApiConfig: config, turn: 2,
    replyBatch: { conversationId: 'group-of-three', messageIds: ['q1'] },
    fallbackPolicy: 'error',
    groupReplyGenerator: async () => { throw new Error('MODEL_DOWN'); },
  })).rejects.toThrow('MODEL_DOWN');
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
