import { describe, expect, it } from 'vitest';
import { appendImagePromptFragments, applyImagePromptSelection, BUILTIN_IMAGE_PROMPT_LIBRARY, normalizeCustomImagePromptLibrary } from '@/utils/imagePromptLibrary';
import { compactImagePrompts } from '@/utils/imagePromptCompaction';
import { compileNovelAIPrompt } from '@/services/ai/novelaiPromptCompiler';
import type { StorySnapshotRenderContext } from '@/models/imageGeneration';

describe('image prompt library additions', () => {
  it('preserves the original request verbatim and only appends new fragments once', () => {
    const original = '安柏: 棕发，绿色眼眸。玩家要求: 城门留影\n(high detail, warm light:1.2), anime';
    expect(appendImagePromptFragments(original, 'ANIME, (high detail, warm light:1.2), clean lineart, clean lineart'))
      .toBe(original + ', clean lineart');
    expect(appendImagePromptFragments(original, '')).toBe(original);
  });
  it('keeps NAI weights and LoRA commas intact while deduplicating', () => {
    expect(appendImagePromptFragments('1.2::blue sky, sunlight::, <lora:foo,bar:1>', '1.2::blue sky, sunlight::, <lora:foo,bar:1>, soft light'))
      .toBe('1.2::blue sky, sunlight::, <lora:foo,bar:1>, soft light');
  });
  it('does not rewrite the other field for positive-only or negative-only selections', () => {
    const draft = { prompt: '安柏, 城门', negative: 'text' };
    expect(applyImagePromptSelection(draft, { positive: 'anime' })).toEqual({ prompt: '安柏, 城门, anime', negative: 'text' });
    expect(applyImagePromptSelection(draft, { negative: 'watermark' })).toEqual({ prompt: '安柏, 城门', negative: 'text, watermark' });
  });
  it('adds snapshot selections to the actual layered base, without touching character facts', () => {
    const context: StorySnapshotRenderContext = { schemaVersion: 1, scenePrompt: 'city gate', sceneNegativePrompt: 'fog',
      characters: [{ name: '安柏', subjectType: 'girl', visualPrompt: 'brown hair, green eyes', negativePrompt: 'wrong hair', source: 'npc' }] };
    const selected = applyImagePromptSelection({ prompt: '安柏 at city gate', negative: 'text', context }, { positive: 'soft light', negative: 'watermark' });
    expect(selected.context?.scenePrompt).toBe('city gate, soft light');
    expect(selected.context?.sceneNegativePrompt).toBe('fog, watermark');
    expect(selected.context?.characters).toBe(context.characters);
    expect(context.scenePrompt).toBe('city gate');
    const compiled = compileNovelAIPrompt({ prompt: selected.prompt, negativePrompt: selected.negative,
      model: 'nai-diffusion-4-full', storySnapshotContext: selected.context });
    expect(compiled.basePrompt).toContain('soft light');
    expect(compiled.baseNegativePrompt).toContain('watermark');
  });
  it('keeps final auto-compaction and named character facts after long library additions', () => {
    const selected = applyImagePromptSelection({ prompt: 'city gate', negative: '' }, { positive: 'forest, '.repeat(1000), negative: 'blur, '.repeat(1000) });
    const final = compactImagePrompts({ ...selected, characters: [{ name: '安柏', visualPrompt: 'brown hair', facts: { name: '安柏', gender: '女', appearance: '棕发' } }] });
    expect(final.prompt.length).toBeLessThanOrEqual(2000);
    expect(final.negative.length).toBeLessThanOrEqual(2000);
    expect(final.prompt).toContain('安柏');
    expect(final.prompt).toContain('棕发');
  });
  it('offers distinguishable regional previews as well as quality and composition fragments', () => {
    const region = (name: string) => BUILTIN_IMAGE_PROMPT_LIBRARY.find(item => item.name === name)!;
    expect(region('蒙德').positive).toMatch(/windmill|gothic/i);
    expect(region('璃月').positive).toMatch(/lantern|harbor/i);
    expect(region('纳塔').positive).toMatch(/volcanic|tribal/i);
    expect(region('至冬').positive).toMatch(/snow|ice/i);
    expect(new Set(BUILTIN_IMAGE_PROMPT_LIBRARY.map(item => item.category))).toEqual(new Set(['画风', '质量', '构图', '国家与地区']));
    expect(BUILTIN_IMAGE_PROMPT_LIBRARY.every(item => item.positive.trim() && item.negative.trim())).toBe(true);
  });
});

describe('custom library normalization', () => {
  it('validates and normalizes a complete persisted pair', () => {
    expect(normalizeCustomImagePromptLibrary({ version: 1, items: [{ id: 'custom-a', name: ' 夜景 ', category: '自定义', positive: ' moonlight ', negative: ' blur ' }] }))
      .toEqual([{ id: 'custom-a', name: '夜景', category: '自定义', positive: 'moonlight', negative: 'blur' }]);
    expect(normalizeCustomImagePromptLibrary(null)).toEqual([]);
  });
  it.each([
    { version: 2, items: [] },
    { version: 1, items: [{ id: 'builtin-style', name: '覆盖', category: '画风', positive: 'x', negative: '' }] },
    { version: 1, items: [{ id: 'custom-a', name: '', category: '自定义', positive: 'x', negative: '' }] },
    { version: 1, items: [{ id: 'custom-a', name: '空', category: '自定义', positive: '', negative: '' }] },
    { version: 1, items: [{ id: 'custom-a', name: 'x', category: '自定义', positive: 'a', negative: '' }, { id: 'custom-a', name: 'y', category: '自定义', positive: 'b', negative: '' }] },
  ])('rejects unknown or damaged persisted content instead of overwriting it', value => {
    expect(() => normalizeCustomImagePromptLibrary(value)).toThrow();
  });
});
