import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateLatentImage } from '@/services/ai/latentImageGeneration';
import { compileNovelAIPrompt } from '@/services/ai/novelaiPromptCompiler';
import { generateImage } from '@/services/ai/imageGeneration';
import { prepareEnglishStoryImage } from '@/services/imageCharacterEnglish';
import { 创建默认文生图API配置 } from '@/models/settings';
import type { StorySnapshotRenderContext } from '@/models/imageGeneration';
import type { EnglishImageCharacterFacts } from '@/models/imageCharacterEnglish';
import { formatImageCharacterFacts } from '@/utils/imageCharacterFacts';

afterEach(() => vi.unstubAllGlobals());
const facts = (index: number): EnglishImageCharacterFacts => ({ language: 'en', name: `Explorer${index}`, gender: 'female',
  appearance: `silver hair, blue eyes, star-shaped brooch ${index}`, outfit: `green coat with gold buttons ${index}`,
  appearanceDetails: { 身高: { value: '172cm', source: 'manual' }, 体重: { value: '58kg', source: 'manual' }, 三围: { value: '90-60-90cm', source: 'manual' } } });
async function prepared(count = 3) {
  const characters = Array.from({ length: count }, (_, index) => ({ name: `测试角色${index}`, visualPrompt: '', facts: facts(index) }));
  const context: StorySnapshotRenderContext = { schemaVersion: 1, scenePrompt: Array.from({ length: 70 }, (_, i) => `sunlit woodland path ${i}`).join(', '), sceneNegativePrompt: 'fog', stylePrompt: Array.from({ length: 40 }, (_, i) => `watercolor texture ${i}`).join(', '),
    characters: characters.map(item => ({ name: item.name, visualPrompt: Array.from({ length: 40 }, (_, i) => `flowing cape detail ${i}`).join(', '), negativePrompt: '', subjectType: 'girl', source: 'npc' })) };
  return prepareEnglishStoryImage({ prompt: 'sunlit forest', negative: 'fog', characters, renderContext: context }, null);
}
function expectRecorded(text: string, index: number) {
  for (const literal of [`Explorer${index}`, '172cm', '58kg', '90-60-90cm', `green coat with gold buttons ${index}`, `star-shaped brooch ${index}`]) expect(text).toContain(literal);
}
describe('recorded facts survive final provider budgets', () => {
  it('disabling a preview character removes its generated caption before translation and the actual Latent request', async () => {
    const alice = { name: 'Alice', visualPrompt: '', facts: { language: 'en' as const, name: 'Alice', appearance: 'silver hair' } };
    const bob = { name: 'Bob', visualPrompt: '', facts: { name: 'Bob', appearance: '绿色头发' } };
    const input = await prepareEnglishStoryImage({ prompt: `forest\n${formatImageCharacterFacts(bob.facts)}`, negative: '', characters: [alice, bob],
      renderContext: { schemaVersion: 1, scenePrompt: 'forest', sceneNegativePrompt: '', characters: [
        { name: 'Alice', visualPrompt: '', negativePrompt: '', subjectType: 'girl', source: 'npc', enabled: true },
        { name: 'Bob', visualPrompt: '', negativePrompt: '', subjectType: 'boy', source: 'npc', enabled: false },
      ] } }, null);
    let payload: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { payload = JSON.parse(String(init.body)); return new Response('image'); });
    await generateLatentImage({ ...创建默认文生图API配置(), apiKey: 'fixture' }, { prompt: input.prompt, storySnapshotContext: input.renderContext }, async () => ({ src: 'fixture', mimeType: 'image/png' }));
    expect(payload.input).toContain('Alice'); expect(payload.input).not.toMatch(/Bob|绿色头发/);
    expect(input.characters.map(character => character.name)).toEqual(['Alice']);
  });
  it('disabled oversized facts do not consume the enabled-character budget or remove manual scene prose', async () => {
    const input = await prepared(2);
    const bob = { name: 'Bob', visualPrompt: '', facts: { language: 'en' as const, name: 'Bob', outfit: 'recorded uniform '.repeat(300) } };
    const result = await prepareEnglishStoryImage({ prompt: `Bob painted this forest\n${formatImageCharacterFacts(bob.facts)}`, negative: '',
      characters: [{ name: '测试角色0', visualPrompt: '', facts: facts(0) }, bob], renderContext: { ...input.renderContext, characters: [input.renderContext.characters[0]!,
        { name: 'Bob', visualPrompt: '', negativePrompt: '', subjectType: 'boy', source: 'npc', enabled: false }] } }, null);
    expect(result.prompt).toContain('Bob painted this forest'); expect(result.prompt).not.toContain('recorded uniform'); expectRecorded(result.prompt, 0);
  });
  it.each(['nai-diffusion-3', 'nai-diffusion-4-full'])('%s preserves structured facts that resemble instructions or contain non-ASCII English names', async model => {
    const recorded = { language: 'en' as const, name: 'Api Élodie', appearance: 'silver hair', outfit: 'coat with API logo and café embroidery' };
    let payload: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { payload = JSON.parse(String(init.body)); return new Response(JSON.stringify({ image: 'fixture' }), { headers: { 'content-type': 'application/json' } }); });
    const result = await generateImage({ ...创建默认文生图API配置(), enabled: true, backend: 'novelai', apiKey: 'fixture', baseUrl: 'https://example.invalid', model }, {
      prompt: 'forest', protectedCharacters: [{ name: recorded.name, visualPrompt: '', facts: recorded }],
    });
    const actual = [payload.input, ...(payload.parameters.v4_prompt?.caption.char_captions ?? []).map((item: any) => item.char_caption)].join(', ');
    expect(actual).toContain(recorded.name); expect(actual).toContain(recorded.outfit);
    expect(result.finalPrompt).toContain(recorded.name); expect(result.finalPrompt).toContain(recorded.outfit);
  });
  it.each([1, 2, 3, 4])('Latent preserves all %s characters after an overlong merge and save round trip', async count => {
    const input = await prepared(count); let payload: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { payload = JSON.parse(String(init.body)); return new Response('image'); });
    const result = await generateLatentImage({ ...创建默认文生图API配置(), apiKey: 'fixture' }, {
      prompt: input.prompt, storySnapshotContext: JSON.parse(JSON.stringify(input.renderContext)),
    }, async () => ({ src: 'data:image/png;base64,fixture', mimeType: 'image/png' }));
    expect(payload.input.length).toBeLessThanOrEqual(2000);
    for (let index = 0; index < count; index++) expectRecorded(payload.input, index);
    expect(payload.input).not.toMatch(/character 测试角色/);
    expect(result.finalPrompt).toBe(payload.input);
  });
  it('NovelAI V4 preserves each character instead of fixed per-person trimming', async () => {
    const input = await prepared();
    const result = compileNovelAIPrompt({ model: 'nai-diffusion-4-full', prompt: input.prompt, storySnapshotContext: input.renderContext });
    result.characterPrompts.forEach((item, index) => expectRecorded(item.prompt, index));
    expect(result.positiveBudget.used).toBeLessThanOrEqual(1600);
  });
  it.each(['latent', 'novelai'] as const)('%s refuses oversized recorded facts before a paid request', async backend => {
    const input = await prepared();
    const huge = input.renderContext.characters.map((item, index) => ({ ...item, facts: { ...facts(index), outfit: 'recorded uniform '.repeat(90) } }));
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(generateImage({ ...创建默认文生图API配置(), enabled: true, backend, apiKey: 'fixture', baseUrl: 'https://example.invalid', model: 'nai-diffusion-4-full' }, {
      prompt: input.prompt, storySnapshotContext: { ...input.renderContext, characters: huge },
    })).rejects.toThrow(/事实|上限/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('NovelAI reports actual final payload rather than the pre-compiler draft', async () => {
    const input = await prepared(); let payload: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { payload = JSON.parse(String(init.body)); return new Response(JSON.stringify({ image: 'fixture' }), { headers: { 'content-type': 'application/json' } }); });
    const result = await generateImage({ ...创建默认文生图API配置(), enabled: true, backend: 'novelai', apiKey: 'fixture', baseUrl: 'https://example.invalid', model: 'nai-diffusion-4-full' }, {
      prompt: input.prompt, storySnapshotContext: input.renderContext,
    });
    const actual = [payload.input, ...payload.parameters.v4_prompt.caption.char_captions.map((item: any) => item.char_caption)].filter(Boolean).join(', ');
    expect(result.finalPrompt).toBe(actual);
    expect(result.finalNegativePrompt).toBe([payload.parameters.uc, ...payload.parameters.v4_negative_prompt.caption.char_captions.map((item: any) => item.char_caption)].filter(Boolean).join(', '));
    expect(result.promptCompacted).toBe(true);
  });
  it.each(['latent', 'novelai'] as const)('%s protects ordinary single-character image requests too', async backend => {
    let payload: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { payload = JSON.parse(String(init.body)); return new Response(JSON.stringify({ image: 'fixture' }), { headers: { 'content-type': 'application/json' } }); });
    if (backend === 'latent') {
      await generateLatentImage({ ...创建默认文生图API配置(), apiKey: 'fixture' }, { prompt: Array.from({ length: 120 }, (_, i) => `decorative background ${i}`).join(', '),
        protectedCharacters: [{ name: 'Explorer0', visualPrompt: '', facts: facts(0) }] } as never, async () => ({ src: 'fixture' } as never));
    } else {
      await generateImage({ ...创建默认文生图API配置(), enabled: true, backend, apiKey: 'fixture', baseUrl: 'https://example.invalid', model: 'nai-diffusion-3' }, {
        prompt: 'sunlit forest', storySnapshotContext: (await prepared()).renderContext,
      });
    }
    expectRecorded(payload.input, 0);
    if (backend === 'novelai') { expectRecorded(payload.input, 1); expectRecorded(payload.input, 2); }
  });
});
