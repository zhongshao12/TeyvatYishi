import { beforeEach, expect, it, vi } from 'vitest';
import { 创建NPC记录 } from '@/models/npc';
import type { API配置项 } from '@/models/settings';
import { createEmptyCourierSystem, type CourierDeliverySeed } from '@/models/teyvat/courier';
import { runCourierDeliveryTask } from '@/hooks/useGame/courierBackgroundJobs';
import { chatCompletion } from '@/services/ai/chatCompletionClient';
import { generateCourierLetter } from '@/services/ai/courierLetterModel';

vi.mock('@/services/ai/chatCompletionClient', () => ({ chatCompletion: vi.fn() }));
beforeEach(() => vi.mocked(chatCompletion).mockReset());

const config: API配置项 = {
  id: 'phone', name: 'phone', provider: 'openai_compatible', baseUrl: 'https://invalid.example',
  apiKey: 'unused', model: 'test', createdAt: 1, updatedAt: 1,
};
const seed: CourierDeliverySeed = {
  id: 'paimon-seed', senderId: 'paimon', reason: '一起清点行囊', turn: 2, source: 'memory',
  triggerType: 'quest', priority: 'normal', targetType: 'private', targetId: 'paimon',
  title: '派蒙近况', context: '<time_format> time: 旅行历 1000.03.11 scene: 蒙德·庙宇。 </time_format>\n派蒙和旅行者一起清点了行囊。',
  relatedNpcIds: ['paimon'], status: 'pending',
};

it('rejects_time_markup_in_generated_letter', async () => {
  vi.mocked(chatCompletion).mockResolvedValue('提醒一声：<time_format> time: 旅行历 1000.03.11 scene: 蒙德·庙宇。');
  await expect(generateCourierLetter(config, { seed, sender: { name: '派蒙' } }))
    .rejects.toThrow('LETTER_CONTAINS_META_TEXT');
});

it('failed_polish_keeps_clean_local_delivery', async () => {
  vi.mocked(chatCompletion).mockResolvedValue('提醒一声：<time_format> time: 旅行历 1000.03.11 scene: 蒙德·庙宇。');
  const paimon = { ...创建NPC记录({ 姓名: '派蒙', 初见回合: 1 }), id: 'paimon' };
  const result = await runCourierDeliveryTask({
    enabled: true, autoGenerateSeeds: false,
    courier: { ...createEmptyCourierSystem(),
      contacts: [{ id: 'paimon', name: '派蒙', npcId: 'paimon', available: true }],
      deliverySeeds: [seed] },
    npcs: [paimon], turn: 2, now: 10, userInput: '', body: '', maxSeedsPerTurn: 1,
    contactCooldownTurns: 0, letterApiConfig: config, environment: { timeText: '旅行历 1000.03.11 13:05' },
  });
  expect(result.delivered).toBe(1);
  const messages = result.courier.conversations.flatMap((conversation) => conversation.messages);
  expect(messages.length).toBeGreaterThan(0);
  expect(messages.map((message) => message.content).join('\n')).not.toMatch(/time_format|time:|scene:|1000\.03\.11/u);
});
