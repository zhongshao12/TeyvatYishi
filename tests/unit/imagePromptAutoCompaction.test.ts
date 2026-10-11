import { afterEach, describe, expect, it, vi } from 'vitest';
import { 创建默认游戏设置 } from '@/models/settings';
import { 创建空角色 } from '@/models/character';
import type { NPC记录 } from '@/models/npc';
import { tokenizeImagePrompt } from '@/services/ai/imagePromptTokenizer';
import { resolveStorySnapshot } from '@/services/ai/storySnapshotPipeline';
import { chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import { compactImagePrompts } from '@/utils/imagePromptCompaction';
import { buildNpcImagePrompt } from '@/utils/imagePromptRules';

vi.mock('@/services/ai/chatCompletionClient', () => ({ chatCompletionNonStream: vi.fn() }));
afterEach(() => vi.clearAllMocks());

describe('generated image prompt simplification', () => {
  it('removes model-facing procedural prose from real defaults rather than drawing instructions', () => {
    const built = buildNpcImagePrompt({
      npc: { 姓名: '安柏', 外貌: 'brown hair, amber eyes', 穿着: 'red rabbit ribbon' } as NPC记录,
      mode: 'avatar', rules: 创建默认游戏设置().文生图系统.rules,
    });
    const result = compactImagePrompts(built);
    expect(result.prompt).not.toMatch(/ComfyUI|JSON|你是|只输出|提示词整理器|不得重新|输出英文/i);
    expect(result.prompt).toContain('warm watercolor');
    expect(result.prompt).toContain('head and shoulders');
  });

  it('preserves complete SD, LoRA and NovelAI weight expressions while removing duplicates', () => {
    const result = compactImagePrompts({ prompt: '(brown hair, amber eyes:1.2), 1.3::red ribbon, red outfit::, <lora:journal:0.7>, (brown hair, amber eyes:1.2), Mondstadt' });
    expect(result.prompt).toBe('(brown hair, amber eyes:1.2), 1.3::red ribbon, red outfit::, <lora:journal:0.7>, Mondstadt');
  });

  it('keeps drawable Chinese actions and explicit accessory constraints rather than mistaking them for procedure', () => {
    const result = compactImagePrompts({ prompt: '把剑握在右手, keep red rabbit ribbon visible, preserve amber eyes, 安柏站在喷泉旁' });
    for (const fact of ['把剑握在右手', 'red rabbit ribbon', 'amber eyes', '安柏站在喷泉旁']) expect(result.prompt).toContain(fact);
  });

  it('does not delete explicit negative restrictions written as sentences', () => {
    const result = compactImagePrompts({ prompt: 'portrait', negative: 'never include nudity, do not change red ribbon, 必须避免文字' });
    expect(result.negative).toBe('never include nudity, do not change red ribbon, 必须避免文字');
  });

  it('retains late identity facts inside long natural-language character descriptions', () => {
    const result = compactImagePrompts({ prompt: 'Mondstadt fountain, sunset', limit: 2000, characters: [{
      name: 'Amber', visualPrompt: 'elaborate embroidered ceremonial costume with silk sleeves and ornate golden trim '.repeat(18) + 'with brown hair and amber eyes and a red rabbit ribbon',
    }] });
    for (const identity of ['Amber', 'brown hair', 'amber eyes', 'red rabbit ribbon']) expect(result.prompt).toContain(identity);
    expect(result.prompt.length).toBeLessThanOrEqual(2000);
  });

  it('keeps adult-only restrictions and identity when shortening long unstructured prose', () => {
    const result = compactImagePrompts({
      prompt: `${'fanciful scenery '.repeat(300)}; character name: 安柏; brown hair; amber eyes; adults only, no minors`,
      negative: `${'low quality, '.repeat(500)}underage, no minors`,
    });
    expect(result.prompt.length).toBeLessThanOrEqual(1800);
    expect(result.negative.length).toBeLessThanOrEqual(1800);
    expect(result.prompt).toContain('adults only');
    expect(result.prompt).toContain('安柏');
    expect(result.negative).toContain('underage');
  });

  it('bounds oversized tokenizer output locally without a second model request', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({
      prompt: `${'beautiful watercolor, '.repeat(200)}character name: 安柏, brown hair, amber eyes, red rabbit ribbon`,
      negative: 'blurry, bad anatomy, '.repeat(200),
    }));
    const result = await tokenizeImagePrompt({ maxTokens: 1600 } as never, 'rules', {
      title: '伙伴头像', mode: 'avatar', sourceText: '安柏', basePrompt: 'portrait', baseNegative: '',
    }, 0);
    expect(result.prompt.length).toBeLessThanOrEqual(1800);
    expect(result.negative.length).toBeLessThanOrEqual(1800);
    for (const tag of ['安柏', 'brown hair', 'amber eyes', 'red rabbit ribbon']) expect(result.prompt).toContain(tag);
    expect(chatCompletionNonStream).toHaveBeenCalledTimes(1);
  });

  it('returns a compact local story snapshot while preserving the original source and scene', async () => {
    const result = await resolveStorySnapshot({
      apiConfig: null, body: '安柏站在蒙德城喷泉旁，夕阳照亮她的红色兔耳发带。',
      traveler: 创建空角色(), playerAppearanceMode: 'off',
      presentNpcs: [{ id: 'amber', 姓名: '安柏', 外貌: 'brown hair, amber eyes', 穿着: 'red rabbit ribbon', 同行: true } as NPC记录],
      rules: 创建默认游戏设置().文生图系统.rules,
    });
    expect(result.prompt.length).toBeLessThanOrEqual(1800);
    expect(result.prompt).toContain('安柏');
    expect(result.prompt).toContain('蒙德');
    expect(result.prompt).toContain('brown hair');
    expect(result.sourcePrompt.length).toBeGreaterThan(result.prompt.length);
    expect(result.renderContext.characters).toHaveLength(1);
  });

  it('simplifies model character fields before context persistence can truncate their identity', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({
      snapshot: { title: '喷泉旁', location: '蒙德', atmosphere: '夕阳', action: '站立', camera: '中景', avoid: '',
        characters: [{ name: '安柏', subjectType: 'girl', visualPrompt: `${'lovely costume detail, '.repeat(90)}brown hair, amber eyes, red rabbit ribbon`, negativePrompt: '' }] },
      prompt: 'Mondstadt fountain, sunset', negativePrompt: 'blurry',
    }));
    const result = await resolveStorySnapshot({
      apiConfig: { baseUrl: 'https://example.test', apiKey: 'test-only', retryCount: 0 } as never,
      body: '安柏站在蒙德喷泉旁。', traveler: 创建空角色(), playerAppearanceMode: 'off',
      presentNpcs: [{ id: 'amber', 姓名: '安柏' } as NPC记录],
      rules: 创建默认游戏设置().文生图系统.rules,
    });
    expect(result.source).toBe('model');
    for (const identity of ['brown hair', 'amber eyes', 'red rabbit ribbon']) {
      expect(result.renderContext.characters[0]?.visualPrompt).toContain(identity);
      expect(result.prompt).toContain(identity);
    }
    expect(result.prompt.length).toBeLessThanOrEqual(1800);
  });
});
