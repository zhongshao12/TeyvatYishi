import { expect, it, vi } from 'vitest';
import {
  composeCourierGroupReplyLocally,
  composeCourierLetterLocally,
  composeCourierReplyLocally,
  extractCourierSpeechEvent,
  type CourierSenderProfile,
} from '@/services/ai/courierService';
import type { CourierConversation, CourierDeliverySeed, CourierMessage } from '@/models/teyvat/courier';
import type { API配置项 } from '@/models/settings';
import { chatCompletion } from '@/services/ai/chatCompletionClient';
import {
  buildCourierGroupReplyPrompt,
  buildCourierLetterPrompt,
  buildCourierReplyPrompt,
  generateCourierGroupReply,
  generateCourierLetter,
  generateCourierReply,
} from '@/services/ai/courierLetterModel';

vi.mock('@/services/ai/chatCompletionClient', () => ({ chatCompletion: vi.fn() }));

const meta = '安柏近期与旅行者有互动，可低频投递一封跟进来信。已发生事实：关于安柏对在戒严区域遇到的陌生人（玩家）留下了深刻的第一印象，可能会有后续联络。';
const seed: CourierDeliverySeed = {
  id: 'seed-2', senderId: 'amber', reason: '跟进', turn: 2, source: 'memory', triggerType: 'quest',
  priority: 'normal', targetType: 'private', targetId: 'amber', title: '近况', context: meta,
  relatedNpcIds: ['amber'], status: 'pending',
};
const sender: CourierSenderProfile = { name: '安柏', recentInteraction: meta };
const playerMessage: CourierMessage = {
  id: 'p-1', senderId: 'player', senderName: '旅行者', role: 'user',
  content: '明天巡逻吗？', turn: 2, timestamp: 2, readBy: ['player'],
};
const conversation: CourierConversation = {
  id: 'amber-chat', title: '安柏', participantIds: ['player', 'amber'], messages: [playerMessage],
  unread: 0, type: 'private', typingMemberIds: [], updatedAt: 2,
};
const config: API配置项 = {
  id: 'test-phone', name: 'test', provider: 'openai_compatible', baseUrl: 'https://invalid.example',
  apiKey: 'unused', model: 'test', createdAt: 1, updatedAt: 1,
};

it('keeps an internal delivery summary out of a local letter', () => {
  const letter = composeCourierLetterLocally({ seed, sender });
  expect(letter.trim()).not.toBe('');
  expect(letter).not.toMatch(/关于安柏对|留下了深刻|可能会有后续联络|可低频投递|已发生事实/u);
});

it('does not recite ledger entries in local private and group replies', () => {
  const privateReply = composeCourierReplyLocally({ conversation, playerMessage, sender });
  const groupReply = composeCourierGroupReplyLocally({ conversation: { ...conversation, type: 'group' }, playerMessage, sender });
  expect(privateReply).not.toMatch(/关于安柏对|我可没忘/u);
  expect(groupReply).not.toMatch(/关于安柏对|我也没有忘/u);
});

it('keeps delivery instructions and ledger prose out of all model prompts', () => {
  const letterPrompt = buildCourierLetterPrompt({ seed, sender });
  const privatePrompt = buildCourierReplyPrompt({ conversation, playerMessage, sender });
  const groupPrompt = buildCourierGroupReplyPrompt({ conversation: { ...conversation, type: 'group' }, playerMessage, sender });
  for (const prompt of [letterPrompt, privatePrompt, groupPrompt]) {
    expect(prompt).not.toMatch(/关于安柏对|可低频投递|已发生事实|可能会有后续联络/u);
  }
  expect(letterPrompt).toContain('寄件人：安柏');
});

it('rejects meta-shaped model output in letters, private replies and group replies', async () => {
  vi.mocked(chatCompletion).mockResolvedValue('关于安柏对玩家留下了深刻的第一印象');
  await expect(generateCourierLetter(config, { seed, sender })).rejects.toThrow('LETTER_CONTAINS_META_TEXT');
  await expect(generateCourierReply(config, { conversation, playerMessage, sender })).rejects.toThrow('REPLY_CONTAINS_META_TEXT');
  await expect(generateCourierGroupReply(config, { conversation: { ...conversation, type: 'group' }, playerMessage, sender })).rejects.toThrow('GROUP_REPLY_CONTAINS_META_TEXT');
});

it('accepts a natural private reminder instead of dropping the character reply', async () => {
  const reply = '对了，你说的巡逻路线我还记着。明天我带你走一遍。';
  vi.mocked(chatCompletion).mockResolvedValue(reply);

  await expect(generateCourierReply(config, { conversation, playerMessage, sender })).resolves.toBe(reply);
});

it.each([
  '根据记忆生成一封跟进来信。',
  '已发生事实：请根据记忆生成一封跟进来信。',
  '可低频投递。',
])('does not turn a metadata-only seed into spoken text: %s', (context) => {
  const instructionSeed = { ...seed, context };
  expect(extractCourierSpeechEvent(context)).toBeNull();
  expect(composeCourierLetterLocally({ seed: instructionSeed, sender })).not.toContain(context);
  expect(buildCourierLetterPrompt({ seed: instructionSeed, sender })).not.toContain(context);
});
