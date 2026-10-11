import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NPC记录 } from '@/models/npc';
import { 创建默认游戏设置 } from '@/models/settings';
import { buildNpcImagePrompt, buildSceneImagePrompt, readImagePromptCharacter } from '@/utils/imagePromptRules';
import { compactImagePrompts, sanitizeImageModelPrompt } from '@/utils/imagePromptCompaction';
import { tokenizeImagePrompt } from '@/services/ai/imagePromptTokenizer';
import { chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import { buildNpcSourceText } from '@/components/features/GameSystems/album/workspaces';
import { 创建空角色 } from '@/models/character';
import { resolveStorySnapshot } from '@/services/ai/storySnapshotPipeline';

// Only replace the external network boundary; prompt builders and compaction stay real.
vi.mock('@/services/ai/chatCompletionClient', () => ({ chatCompletionNonStream: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const npc = {
  id: 'test-adult', 姓名: '测试成年角色', 性别: '女', 外貌: 'brown hair, amber eyes', 穿着: 'red travel coat',
  外貌档案: {
    发色: { value: 'brown', source: 'canon' }, 瞳色: { value: 'amber', source: 'manual' },
    身高: { value: '168 cm', source: 'narrative' }, 体重: { value: '55 kg', source: 'ai_estimate' },
    三围: { value: '90/60/90 cm', source: 'manual' },
  },
  NSFW档案: { enabled: true, 年龄确认: 'adult', 年龄确认来源: 'manual', 常用内衣: 'private underwear sentinel', 备注: 'private archive sentinel' },
} as NPC记录;
const facts = ['测试成年角色', 'gender: 女', 'brown hair', 'amber eyes', 'red travel coat', '发色: brown', 'canon', '瞳色: amber', 'manual', '身高: 168 cm', 'narrative', '体重: 55 kg', 'ai_estimate', '三围: 90/60/90 cm'];

describe('image character facts', () => {
  it('includes recorded values and provenance in an ordinary NPC prompt without private archives', () => {
    const result = buildNpcImagePrompt({ npc, mode: 'avatar', rules: 创建默认游戏设置().文生图系统.rules });
    for (const fact of facts) expect(result.prompt).toContain(fact);
    expect(result.prompt).not.toContain('private archive sentinel');
    expect(result.prompt).not.toContain('private underwear sentinel');
  });

  it('keeps every recorded fact when locally compacting a noisy prompt', () => {
    const result = compactImagePrompts({ prompt: 'scene, sunset, ' + 'decorative scenery, '.repeat(250), characters: [readImagePromptCharacter(npc)] });
    for (const fact of facts) expect(result.prompt).toContain(fact);
    expect(result.prompt.length).toBeLessThanOrEqual(1800);
  });

  it('restores known facts when the tokenizer model omits them', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({ prompt: 'portrait, soft light', negative: 'blurry' }));
    const result = await tokenizeImagePrompt({ maxTokens: 1600 } as never, 'rules', {
      title: '伙伴头像', mode: 'avatar', sourceText: '测试成年角色', basePrompt: 'portrait', baseNegative: '',
      characters: [readImagePromptCharacter(npc)],
    }, 0);
    for (const fact of facts) expect(result.prompt).toContain(fact);
    expect(result.prompt).toContain('soft light');
    expect(result.prompt.length).toBeLessThanOrEqual(1800);
  });

  it('never synthesizes missing measurements from descriptive prose', () => {
    const character = readImagePromptCharacter({ 姓名: '未知角色', 性别: '女', 外貌: 'tall, slim', 穿着: 'blue coat' });
    const result = compactImagePrompts({ prompt: 'portrait', characters: [character] });
    expect(result.prompt).toContain('gender: 女');
    expect(result.prompt).not.toMatch(/身高:|体重:|三围:|\d+\s*(?:cm|kg)/);
  });

  it('applies the existing measurement gate without discarding permitted height and weight', () => {
    const result = compactImagePrompts({ prompt: 'portrait', characters: [readImagePromptCharacter({ ...npc, NSFW档案: { 年龄确认: 'unknown' } })] });
    expect(result.prompt).toContain('身高: 168 cm');
    expect(result.prompt).toContain('体重: 55 kg');
    expect(result.prompt).not.toContain('90/60/90');
  });

  it('preserves profile facts while marking an enabled anchor as higher priority', () => {
    const character = readImagePromptCharacter({ ...npc, 图像档案: { 角色锚点: { 正面提示词: 'brown hair, amber eyes', 负面提示词: 'blue eyes' } } });
    const result = compactImagePrompts({ prompt: 'portrait', characters: [character] });
    for (const fact of facts) expect(result.prompt).toContain(fact);
    expect(result.prompt).toContain('brown hair');
    expect(result.prompt).toContain('amber eyes');
    expect(result.prompt).toMatch(/anchor[^,]*priority over profile/i);
    expect(result.negative).toContain('blue eyes');
  });

  it.each([
    { 是否启用: false }, { 场景生图自动注入: false },
  ])('does not reintroduce an ineligible scene anchor: %j', switches => {
    const character = readImagePromptCharacter({ ...npc, 图像档案: { 角色锚点: { ...switches, 正面提示词: 'silver hair sentinel', 负面提示词: 'anchor negative sentinel' } } }, true);
    const result = compactImagePrompts({ prompt: 'scene', characters: [character] });
    expect(result.prompt).not.toContain('silver hair sentinel');
    expect(result.negative).not.toContain('anchor negative sentinel');
    for (const fact of facts) expect(result.prompt).toContain(fact);
  });

  it('supplies safe recorded appearance facts to ordinary tokenizer source text', () => {
    const result = buildNpcSourceText(npc);
    expect(result).toContain('身高: 168 cm');
    expect(result).toContain('narrative');
    expect(result).not.toContain('private archive sentinel');
    expect(result).not.toContain('private underwear sentinel');
  });

  it('includes present NPC facts even when a scene has no enabled anchors', () => {
    const result = buildSceneImagePrompt({ text: 'standing beside a fountain', mode: 'scene', presentNpcs: [npc], rules: 创建默认游戏设置().文生图系统.rules });
    for (const fact of facts) expect(result.prompt).toContain(fact);
    expect(result.prompt).not.toContain('private archive sentinel');
  });

  it('reserves an enabled anchor before scenery even when profile facts fill most of the limit', () => {
    const character = readImagePromptCharacter({ ...npc, 图像档案: { 角色锚点: { 正面提示词: 'brown hair, amber eyes' } } });
    const result = compactImagePrompts({ prompt: 'beautiful scenery, '.repeat(100), characters: [character], limit: 600 });
    expect(result.prompt).toContain('brown hair');
    expect(result.prompt).toContain('amber eyes');
    for (const fact of facts) expect(result.prompt).toContain(fact);
    expect(result.prompt.length).toBeLessThanOrEqual(600);
  });

  it('preserves an explicitly requested NSFW source without leaking it into ordinary sources', () => {
    const result = buildNpcSourceText(npc, { nsfw: true });
    expect(result).toContain('private archive sentinel');
  });

  it('does not duplicate protected facts when tokenizer output is finalized a second time', () => {
    const characters = [readImagePromptCharacter(npc)];
    const first = compactImagePrompts({ prompt: 'portrait, sunset', characters });
    const second = compactImagePrompts({ ...first, characters });
    expect(second.prompt).toBe(first.prompt);
  });

  it('retains safe NPC facts in persisted local snapshot character captions', async () => {
    const result = await resolveStorySnapshot({
      apiConfig: null, body: '测试成年角色站在蒙德喷泉旁。', traveler: 创建空角色(), presentNpcs: [npc],
      playerAppearanceMode: 'off', rules: 创建默认游戏设置().文生图系统.rules,
    });
    for (const fact of facts) {
      expect(result.renderContext.characters[0]?.visualPrompt).toContain(fact);
      expect(result.prompt).toContain(fact);
    }
    expect(result.prompt.length).toBeLessThanOrEqual(1800);
    expect(JSON.stringify(result.renderContext)).not.toContain('private archive sentinel');
  });

  it('restores safe NPC facts after a snapshot model replaces the character description', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({
      snapshot: { title: '喷泉旁', location: '蒙德', atmosphere: '夕阳', action: '站立', camera: '中景', avoid: '',
        characters: [{ name: '测试成年角色', subjectType: 'girl', visualPrompt: 'standing, silver pendant', negativePrompt: '' }] },
      prompt: 'Mondstadt fountain, sunset', negativePrompt: 'blurry',
    }));
    const result = await resolveStorySnapshot({
      apiConfig: { baseUrl: 'https://example.test', apiKey: 'test-only', retryCount: 0 } as never,
      body: '测试成年角色站在蒙德喷泉旁。', traveler: 创建空角色(), presentNpcs: [npc],
      playerAppearanceMode: 'off', rules: 创建默认游戏设置().文生图系统.rules,
    });
    expect(result.source).toBe('model');
    for (const fact of facts) {
      expect(result.renderContext.characters[0]?.visualPrompt).toContain(fact);
      expect(result.prompt).toContain(fact);
    }
    expect(result.prompt).toContain('silver pendant');
    expect(result.prompt.length).toBeLessThanOrEqual(1800);
  });

  it('sends safe fact values and provenance to the snapshot parser network boundary', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({
      snapshot: { title: '喷泉旁', location: '蒙德', atmosphere: '夕阳', action: '站立', camera: '中景', avoid: '', characters: ['测试成年角色'] },
      prompt: 'Mondstadt fountain', negativePrompt: '',
    }));
    await resolveStorySnapshot({
      apiConfig: { baseUrl: 'https://example.test', apiKey: 'test-only', retryCount: 0 } as never,
      body: '测试成年角色站在蒙德喷泉旁。', traveler: 创建空角色(), presentNpcs: [npc],
      playerAppearanceMode: 'off', rules: 创建默认游戏设置().文生图系统.rules,
    });
    const request = vi.mocked(chatCompletionNonStream).mock.calls[0]?.[1].messages[0]?.content;
    for (const fact of facts) expect(request).toContain(fact);
    expect(request).not.toContain('private archive sentinel');
    expect(request).not.toContain('private underwear sentinel');
  });

  it('does not send a disabled traveler scene anchor to the snapshot parser', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({
      snapshot: { title: '喷泉旁', location: '蒙德', atmosphere: '夕阳', action: '站立', camera: '中景', avoid: '', characters: ['旅人'] },
      prompt: 'Mondstadt fountain', negativePrompt: '',
    }));
    await resolveStorySnapshot({
      apiConfig: { baseUrl: 'https://example.test', apiKey: 'test-only', retryCount: 0 } as never,
      body: '旅人站在喷泉旁。', traveler: { ...创建空角色(), 姓名: '旅人', 图像档案: { 角色锚点: { 场景生图自动注入: false, 正面提示词: 'disabled anchor sentinel' } } }, presentNpcs: [],
      playerAppearanceMode: 'force', rules: 创建默认游戏设置().文生图系统.rules,
    });
    const request = vi.mocked(chatCompletionNonStream).mock.calls[0]?.[1].messages[0]?.content;
    expect(request).not.toContain('disabled anchor sentinel');
  });

  it('keeps a source-named NPC when the snapshot model calls them only a silver-haired girl', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({
      snapshot: { title: '喷泉旁', location: '蒙德', atmosphere: '夕阳', action: '站立', camera: '中景', avoid: '', characters: ['silver-haired girl'] },
      prompt: 'silver-haired girl beside Mondstadt fountain', negativePrompt: '',
    }));
    const result = await resolveStorySnapshot({
      apiConfig: { baseUrl: 'https://example.test', apiKey: 'test-only', retryCount: 0 } as never,
      body: '测试成年角色站在蒙德喷泉旁。', traveler: 创建空角色(), presentNpcs: [npc],
      playerAppearanceMode: 'off', rules: 创建默认游戏设置().文生图系统.rules,
    });
    expect(result.source).toBe('model');
    for (const fact of facts) expect(result.prompt).toContain(fact);
    expect(result.renderContext.characters[0]?.name).toBe('测试成年角色');
  });

  it('drops recognizably conflicting profile colors when a stable anchor defines them', () => {
    const result = compactImagePrompts({ prompt: 'portrait', characters: [readImagePromptCharacter({
      ...npc, 图像档案: { 角色锚点: { 正面提示词: 'silver hair, green eyes' } },
    })] });
    expect(result.prompt).toContain('silver hair');
    expect(result.prompt).toContain('green eyes');
    expect(result.prompt).not.toMatch(/brown|amber/);
    expect(result.prompt).toContain('red travel coat');
    expect(result.prompt).toContain('身高: 168 cm');
    expect(npc.外貌档案?.发色?.value).toBe('brown');
  });

  it('removes numeric measurements invented by the tokenizer but leaves manual prompt compaction unchanged', async () => {
    const invented = 'portrait, height: 170 cm, weight: 58 kg, bust: 90 cm, 三围: 90/60/90 cm';
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({ prompt: invented, negative: '' }));
    const result = await tokenizeImagePrompt({ maxTokens: 1600 } as never, 'rules', {
      title: '伙伴头像', mode: 'avatar', sourceText: '未知角色', basePrompt: 'portrait', baseNegative: '',
      characters: [readImagePromptCharacter({ 姓名: '未知角色', 性别: '女', 外貌: 'short black hair' })],
    }, 0);
    expect(result.prompt).not.toMatch(/170|58|90\/60\/90|bust: 90/);
    expect(result.prompt).toContain('short black hair');
    expect(compactImagePrompts({ prompt: invented }).prompt).toContain('height: 170 cm');
  });

  it('does not authorize invented height merely because the same number exists in a weight record', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({ prompt: 'portrait, height: 55 cm, weight: 55 kg', negative: '' }));
    const result = await tokenizeImagePrompt({ maxTokens: 1600 } as never, 'rules', {
      title: '伙伴头像', mode: 'avatar', sourceText: '已知体重', basePrompt: 'portrait', baseNegative: '',
      characters: [readImagePromptCharacter({ 姓名: '已知体重', 外貌档案: { 体重: { value: '55 kg', source: 'manual' } } })],
    }, 0);
    expect(result.prompt).not.toContain('height: 55');
    expect(result.prompt).toContain('体重: 55 kg');
  });

  it('keeps manual base measurements when invalid model JSON requires a local fallback', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValue('not usable JSON');
    const result = await tokenizeImagePrompt({ maxTokens: 1600 } as never, 'rules', {
      title: '伙伴头像', mode: 'avatar', sourceText: '未知角色', basePrompt: 'portrait, height: 170 cm', baseNegative: '',
      characters: [readImagePromptCharacter({ 姓名: '未知角色' })],
    }, 0);
    expect(result.prompt).toContain('height: 170 cm');
  });

  it('removes complete weighted measurement fragments instead of leaving dangling brackets', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({ prompt: 'portrait, (height: 170 cm, slim body:1.2), red coat', negative: '' }));
    const result = await tokenizeImagePrompt({ maxTokens: 1600 } as never, 'rules', {
      title: '伙伴头像', mode: 'avatar', sourceText: '未知角色', basePrompt: 'portrait', baseNegative: '',
      characters: [readImagePromptCharacter({ 姓名: '未知角色' })],
    }, 0);
    expect(result.prompt).not.toMatch(/170|[()]/);
    expect(result.prompt).toContain('red coat');
  });

  it('removes unsupported model measurements even when an older caller supplies no character facts', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({ prompt: 'portrait, height: 170 cm', negative: '' }));
    const result = await tokenizeImagePrompt({ maxTokens: 1600 } as never, 'rules', {
      title: '场景图', mode: 'scene', sourceText: 'a person beside a fountain', basePrompt: 'portrait', baseNegative: '',
    }, 0);
    expect(result.prompt).not.toContain('170');
  });

  it('removes single-character model colors that contradict the eligible stable anchor', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({ prompt: 'portrait, brown hair, amber eyes, rabbit ear headband', negative: '' }));
    const result = await tokenizeImagePrompt({ maxTokens: 1600 } as never, 'rules', {
      title: '伙伴头像', mode: 'avatar', sourceText: '测试成年角色', basePrompt: 'portrait', baseNegative: '',
      characters: [readImagePromptCharacter({ ...npc, 图像档案: { 角色锚点: { 正面提示词: 'silver hair, green eyes' } } })],
    }, 0);
    expect(result.prompt).not.toMatch(/brown|amber/);
    expect(result.prompt).toContain('silver hair');
    expect(result.prompt).toContain('green eyes');
    expect(result.prompt).toContain('rabbit ear headband');
  });

  it('retains accessories sharing a profile clause with a conflicting hair or eye color', () => {
    const result = compactImagePrompts({ prompt: 'portrait', characters: [readImagePromptCharacter({
      ...npc, 外貌: 'brown hair and rabbit ear headband, amber eyes with silver earrings',
      图像档案: { 角色锚点: { 正面提示词: 'silver hair, green eyes' } },
    })] });
    expect(result.prompt).not.toMatch(/brown|amber/);
    expect(result.prompt).toContain('rabbit ear headband');
    expect(result.prompt).toContain('silver earrings');
  });

  it('does not globally strip another person colors from a multi-character model prompt', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({ prompt: 'two people, brown hair, amber eyes', negative: '' }));
    const result = await tokenizeImagePrompt({ maxTokens: 1600 } as never, 'rules', {
      title: '场景图', mode: 'scene', sourceText: '两位角色站在喷泉旁', basePrompt: 'scene', baseNegative: '',
      characters: [
        readImagePromptCharacter({ ...npc, 图像档案: { 角色锚点: { 正面提示词: 'silver hair, green eyes' } } }),
        readImagePromptCharacter({ 姓名: '另一位角色', 性别: '男', 外貌: 'black hair, blue eyes' }),
      ],
    }, 0);
    expect(result.prompt).toContain('brown hair');
    expect(result.prompt).toContain('amber eyes');
    expect(result.prompt).toContain('silver hair');
    expect(result.prompt).toContain('另一位角色');
  });

  it('keeps recorded traveler top-level height without inventing measurement provenance', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({ prompt: 'portrait, height: 170 cm', negative: '' }));
    const result = await tokenizeImagePrompt({ maxTokens: 1600 } as never, 'rules', {
      title: '旅人头像', mode: 'avatar', sourceText: '旅人身高170 cm', basePrompt: 'portrait', baseNegative: '',
      characters: [readImagePromptCharacter({ 姓名: '旅人', 身高: '170 cm' })],
    }, 0);
    expect(result.prompt).toContain('170 cm');
    expect(result.prompt).toContain('traveler_profile');
    expect(result.prompt).not.toMatch(/source: (?:canon|manual|narrative|ai_estimate)/);
  });

  it('prefers a structured height record over the top-level profile height', async () => {
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({ prompt: 'portrait, height: 170 cm', negative: '' }));
    const result = await tokenizeImagePrompt({ maxTokens: 1600 } as never, 'rules', {
      title: '旅人头像', mode: 'avatar', sourceText: '旅人', basePrompt: 'portrait', baseNegative: '',
      characters: [readImagePromptCharacter({ 姓名: '旅人', 身高: '170 cm', 外貌档案: { 身高: { value: '172 cm', source: 'manual' } } })],
    }, 0);
    expect(result.prompt).not.toContain('170 cm');
    expect(result.prompt).toContain('身高: 172 cm');
    expect(result.prompt).toContain('source: manual');
  });

  it('sanitizes snapshot model scene and character blocks against known facts and a single stable anchor', async () => {
    const silver = { ...npc, 姓名: '银发角色', 外貌档案: undefined, 图像档案: { 角色锚点: { 正面提示词: 'silver hair, green eyes' } } } as NPC记录;
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({
      snapshot: { title: '喷泉旁', location: '蒙德', atmosphere: '夕阳', action: '站立', camera: '中景', avoid: '',
        characters: [{ name: '银发角色', subjectType: 'girl', visualPrompt: 'brown hair, amber eyes, height: 170 cm, rabbit ear headband', negativePrompt: '' }] },
      prompt: 'Mondstadt fountain, brown hair, amber eyes, height: 170 cm, weight: 58 kg', negativePrompt: '',
    }));
    const result = await resolveStorySnapshot({
      apiConfig: { baseUrl: 'https://example.test', apiKey: 'test-only', retryCount: 0 } as never,
      body: '银发角色站在蒙德喷泉旁。', traveler: 创建空角色(), presentNpcs: [silver],
      playerAppearanceMode: 'off', rules: 创建默认游戏设置().文生图系统.rules,
    });
    expect(result.source).toBe('model');
    for (const prompt of [result.prompt, result.renderContext.scenePrompt, result.renderContext.characters[0]?.visualPrompt]) {
      expect(prompt).not.toMatch(/170|58|brown|amber/);
    }
    expect(result.prompt).toContain('silver hair');
    expect(result.prompt).toContain('green eyes');
    expect(result.prompt).toContain('rabbit ear headband');
  });

  it('sanitizes an attributed snapshot character without globally stripping another character colors', async () => {
    const silver = { ...npc, 姓名: '银发角色', 外貌档案: undefined, 图像档案: { 角色锚点: { 正面提示词: 'silver hair, green eyes' } } } as NPC记录;
    const other = { 姓名: '棕发角色', 性别: '男', 外貌: 'brown hair, amber eyes' } as NPC记录;
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({
      snapshot: { title: '喷泉旁', location: '蒙德', atmosphere: '夕阳', action: '站立', camera: '中景', avoid: '',
        characters: [
          { name: '银发角色', subjectType: 'girl', visualPrompt: 'brown hair, amber eyes, height: 170 cm, rabbit ear headband', negativePrompt: '' },
          { name: '棕发角色', subjectType: 'boy', visualPrompt: 'brown hair, amber eyes', negativePrompt: '' },
        ] },
      prompt: 'Mondstadt fountain, two people, brown hair, amber eyes', negativePrompt: '',
    }));
    const result = await resolveStorySnapshot({
      apiConfig: { baseUrl: 'https://example.test', apiKey: 'test-only', retryCount: 0 } as never,
      body: '银发角色和棕发角色站在蒙德喷泉旁。', traveler: 创建空角色(), presentNpcs: [silver, other],
      playerAppearanceMode: 'off', rules: 创建默认游戏设置().文生图系统.rules,
    });
    expect(result.source).toBe('model');
    expect(result.renderContext.characters[0]?.visualPrompt).not.toMatch(/brown|amber|170/);
    expect(result.renderContext.characters[0]?.visualPrompt).toContain('rabbit ear headband');
    expect(result.renderContext.characters[1]?.visualPrompt).toContain('brown hair');
    expect(result.renderContext.scenePrompt).toContain('brown hair');
    expect(result.prompt).toContain('brown hair');
  });

  it.each([
    ['height: 170 inches', 'portrait'],
    ['height: 170 kg', 'portrait'],
    ['weight: 55 lb', 'portrait'],
    ['height: 170 centimeters', 'portrait, height: 170 centimeters'],
    ['weight: 55 kilograms', 'portrait, weight: 55 kilograms'],
  ])('checks known measurement units instead of accepting matching digits: %s', (tag, expected) => {
    const result = sanitizeImageModelPrompt(`portrait, ${tag}`, [readImagePromptCharacter({
      姓名: '已记录角色', 身高: '170 cm', 外貌档案: { 体重: { value: '55 kg', source: 'manual' } },
    })]);
    expect(result).toBe(expected);
  });

  it.each([
    ['1.7 m', 'height: 1.7 meters'],
    ['67 inches', 'height: 67 in'],
    ['67 inch', 'height: 67 inches'],
  ])('accepts familiar height unit aliases without conversion: %s', (height, tag) => {
    expect(sanitizeImageModelPrompt(`portrait, ${tag}`, [readImagePromptCharacter({ 姓名: '旅人', 身高: height })])).toBe(`portrait, ${tag}`);
  });

  it('removes unrecorded meter-height prose while retaining scene distance and doorway dimensions', () => {
    const result = sanitizeImageModelPrompt('portrait, 1.7m tall, standing 2m away, 1.7m doorway');
    expect(result).toBe('portrait, standing 2m away, 1.7m doorway');
    expect(compactImagePrompts({ prompt: 'portrait, 1.7m tall' }).prompt).toContain('1.7m tall');
  });

  it.each([
    ['measurements: 60/90/60 cm', 'portrait'],
    ['measurements: 90/60/90 centimeters', 'portrait, measurements: 90/60/90 centimeters'],
    ['bust: 60 cm', 'portrait'],
    ['waist: 90 cm', 'portrait'],
    ['hips: 60 cm', 'portrait'],
    ['bust: 90 cm', 'portrait, bust: 90 cm'],
    ['waist: 60 cm', 'portrait, waist: 60 cm'],
    ['hips: 90 cm', 'portrait, hips: 90 cm'],
  ])('matches the ordered recorded bust-waist-hips tuple: %s', (tag, expected) => {
    expect(sanitizeImageModelPrompt(`portrait, ${tag}`, [readImagePromptCharacter(npc)])).toBe(expected);
  });
});
