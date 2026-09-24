import { expect, it, vi } from 'vitest';
import { 创建NPC记录 } from '@/models/npc';
import type { API配置项 } from '@/models/settings';
import type { CourierMoment } from '@/models/teyvat/courier';
import { chatCompletion } from '@/services/ai/chatCompletionClient';
import { buildMomentCommentPrompt, generateMomentComment } from '@/services/ai/courierMomentComments';

vi.mock('@/services/ai/chatCompletionClient', () => ({ chatCompletion: vi.fn() }));

const post: CourierMoment = {
  id: 'p1', authorId: 'player', content: '今天登上了风起地的山坡。', turn: 3,
  createdAt: 1, updatedAt: 1, revision: 1, targets: [], comments: [],
};
const amber = { ...创建NPC记录({ 姓名: '安柏', 初见回合: 1 }), id: 'amber', 好感度: 101 };
const config: API配置项 = {
  id: 'phone', name: 'phone', provider: 'openai_compatible', baseUrl: 'https://invalid.example',
  apiKey: 'unused', model: 'test', createdAt: 1, updatedAt: 1,
};

it('prompts one NPC using only that NPC’s shared memory and personality', () => {
  const prompt = buildMomentCommentPrompt({ post, npc: amber, profile: {
    name: '安柏', personality: '热情的侦察骑士', speechStyle: '爽朗',
    sharedExperiences: ['一起巡逻'], recentMemories: ['丽莎独自透露的秘密'],
  } });
  expect(prompt).toContain('热情的侦察骑士');
  expect(prompt).toContain('一起巡逻');
  expect(prompt).not.toContain('丽莎独自透露的秘密');
});

it('rejects a meta-summary instead of delivering a fake comment', async () => {
  vi.mocked(chatCompletion).mockResolvedValue('关于安柏对玩家留下了深刻的第一印象');
  await expect(generateMomentComment(config, { post, npc: amber, profile: { name: '安柏' } }))
    .rejects.toThrow('MOMENT_COMMENT_INVALID');
});

it('accepts one short natural comment without a role label', async () => {
  vi.mocked(chatCompletion).mockResolvedValue('安柏：下次叫上我一起去呀！');
  await expect(generateMomentComment(config, { post, npc: amber, profile: { name: '安柏' } }))
    .resolves.toBe('下次叫上我一起去呀！');
});
