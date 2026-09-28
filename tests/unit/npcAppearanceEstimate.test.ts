import { describe, expect, it, vi } from 'vitest';
import { 创建NPC记录 } from '@/models/npc';
import type { API配置项 } from '@/models/settings';
import { applyNpcAppearanceEstimate, generateNpcAppearanceEstimate, setNpcAppearanceFact } from '@/services/ai/npcAppearanceEstimate';
import { chatCompletionNonStream } from '@/services/ai/chatCompletionClient';

vi.mock('@/services/ai/chatCompletionClient', () => ({ chatCompletionNonStream: vi.fn() }));

const config = { id: 'test', name: 'test', provider: 'openai_compatible', baseUrl: 'https://example.test', apiKey: 'test', model: 'test' } as API配置项;
const makeAdult = () => ({
  ...创建NPC记录({ 姓名: '阿明', 阶位: 'companion', 初见回合: 1, 性别: '女', NSFW档案: { 年龄确认: 'adult', 年龄确认来源: 'manual' } }),
  id: 'npc_aming',
});

describe('AI appearance estimate', () => {
  it('fills_only_blanks_and_marks_ai_estimate', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValueOnce(JSON.stringify({ npcId: 'npc_aming', facts: { 发色: '银白色', 瞳色: '蓝色', 身高: '168 cm' } }));
    const npc = { ...makeAdult(), 外貌档案: { 发色: { value: '黑色', source: 'manual' as const } } };
    const estimate = await generateNpcAppearanceEstimate(config, npc);
    const next = applyNpcAppearanceEstimate(npc, estimate);
    expect(next.外貌档案?.发色).toEqual({ value: '黑色', source: 'manual' });
    expect(next.外貌档案?.瞳色).toEqual({ value: '蓝色', source: 'ai_estimate' });
    expect(next.外貌档案?.身高).toEqual({ value: '168 cm', source: 'ai_estimate' });
  });

  it('rejects_partial_invalid_response without writing any part', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValueOnce(JSON.stringify({ npcId: 'npc_aming', facts: { 发色: '银白色', 身高: '999 cm' } }));
    await expect(generateNpcAppearanceEstimate(config, makeAdult())).rejects.toThrow();
  });

  it('unknown_age_cannot_accept_measurements or a model-declared adult age', async () => {
    const npc = { ...创建NPC记录({ 姓名: '阿明', 阶位: 'companion', 初见回合: 1, 性别: '女' }), id: 'npc_aming' };
    vi.mocked(chatCompletionNonStream).mockResolvedValueOnce(JSON.stringify({ npcId: 'npc_aming', ageConfirmation: 'adult', facts: { 发色: '银白色', 三围: '86/61/88 cm' } }));
    await expect(generateNpcAppearanceEstimate(config, npc)).rejects.toThrow();
    expect(applyNpcAppearanceEstimate(npc, { 三围: { value: '86/61/88 cm', source: 'ai_estimate' } }).外貌档案?.三围).toBeUndefined();
  });

  it('manual_value_survives_regeneration', () => {
    const npc = setNpcAppearanceFact(makeAdult(), '身高', '165 cm');
    const next = applyNpcAppearanceEstimate(npc, { 身高: { value: '168 cm', source: 'ai_estimate' }, 体重: { value: '54 kg', source: 'ai_estimate' } });
    expect(next.外貌档案?.身高).toEqual({ value: '165 cm', source: 'manual' });
    expect(next.外貌档案?.体重).toEqual({ value: '54 kg', source: 'ai_estimate' });
  });

  it('rejects a response bound to another NPC id', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValueOnce(JSON.stringify({ npcId: 'npc_other', facts: { 发色: '银白色' } }));
    await expect(generateNpcAppearanceEstimate(config, makeAdult())).rejects.toThrow();
  });
});
