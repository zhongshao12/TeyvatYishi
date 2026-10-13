import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateNarrativeImage } from '@/services/ai/imageGeneration';
import { 创建默认文生图系统设置 } from '@/models/settings';
import { 创建空角色 } from '@/models/character';
import { 创建NPC记录, type NPC记录 } from '@/models/npc';
import { imageCharacterSourceKey } from '@/utils/imageCharacterFacts';
import { resolveStorySnapshot } from '@/services/ai/storySnapshotPipeline';
afterEach(() => vi.unstubAllGlobals());
describe('automatic images reuse prepared English profiles', () => {
  it.each(['positive-anchor', 'negative', 'character-negative', 'scene-negative'] as const)('blocks an unprepared changed %s without a paid image call', async field => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWMsAAAAASUVORK5CYII=' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const config = { ...创建默认文生图系统设置().普通接口, backend: 'openai_compatible' as const, enabled: true, baseUrl: 'https://example.invalid/v1', model: 'image', apiKey: 'unused' };
    const prompt = '蒙德图书馆\ncharacter name: Lisa\ngender: female\nappearance: purple hair';
    const context = { schemaVersion: 1 as const, scenePrompt: 'library', sceneNegativePrompt: field === 'scene-negative' ? '紫色头发' : 'text',
      characters: [{ name: '丽莎', enabled: true, visualPrompt: 'character name: Lisa\nappearance: purple hair', negativePrompt: field === 'character-negative' ? '紫色头发' : 'text' }] };
    const result = await generateNarrativeImage(config, field === 'positive-anchor' ? `${prompt}\ncharacter anchor positive prompt: 银色长发` : prompt,
      field === 'negative' ? '紫色头发' : 'text', 'scene', 'snapshot', 'image', context as never);
    expect(result.status).toBe('failed');
    expect(result.error).toContain('英文');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports missing preparation without silently translating or paying for a Chinese character profile', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const config = { ...创建默认文生图系统设置().普通接口, enabled: true };
    const result = await generateNarrativeImage(config, 'scene, character name: 丽莎\ngender: 女\nappearance: 紫色长发', '', 'scene', 'snapshot', 'image');
    expect(result.status).toBe('failed'); expect(result.error).toContain('英文'); expect(fetch).not.toHaveBeenCalled();
  });
  it('accepts prepared English facts while leaving Chinese scene descriptions available', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWMsAAAAASUVORK5CYII=' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const config = { ...创建默认文生图系统设置().普通接口, backend: 'openai_compatible' as const, enabled: true, baseUrl: 'https://example.invalid/v1', model: 'image', apiKey: 'unused' };
    const result = await generateNarrativeImage(config, '蒙德的图书馆\ncharacter name: Lisa\ngender: female\nappearance: purple hair', '', 'scene', 'snapshot', 'image');
    expect(result.status, result.error).toBe('done'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('consumes restored English anchors in the complete local snapshot image request', async () => {
    const npc: NPC记录 = { ...创建NPC记录({ 姓名: '安柏', 初见回合: 1 }), 性别: '女', 外貌: '棕色长发，绿眼睛',
      图像档案: { 角色锚点: { 正面提示词: '棕色长发，红色兔耳发饰', 负面提示词: '紫色头发', 场景生图自动注入: true } } };
    const savedNpc = JSON.parse(JSON.stringify({ ...npc, 图像档案: { ...npc.图像档案, englishFacts: {
      schemaVersion: 1, sourceKey: imageCharacterSourceKey(npc), preparedAt: 1,
      facts: { language: 'en', name: 'Amber', gender: 'female', appearance: 'brown long hair, green eyes' },
      anchorSourceKey: JSON.stringify({ prompt: 'character anchor positive prompt: 棕色长发，红色兔耳发饰', negative: '紫色头发' }),
      anchorPrompt: 'character anchor positive prompt: brown long hair, red bunny-ear ribbon', anchorNegative: 'purple hair',
    } } }));
    const settings = 创建默认文生图系统设置();
    const snapshot = await resolveStorySnapshot({ apiConfig: null, body: '安柏站在蒙德城门旁。', traveler: 创建空角色(),
      presentNpcs: [savedNpc], playerAppearanceMode: 'off', rules: settings.rules });
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWMsAAAAASUVORK5CYII=' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const config = { ...settings.普通接口, backend: 'openai_compatible' as const, enabled: true, baseUrl: 'https://example.invalid/v1', model: 'image', apiKey: 'unused' };
    const generated = await generateNarrativeImage(config, snapshot.prompt, snapshot.negativePrompt, 'scene', 'snapshot', 'image', snapshot.renderContext);
    expect(generated.status, generated.error).toBe('done');
    const payload = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(payload.prompt).toContain('purple hair');
    expect(payload.prompt).toContain('red bunny-ear ribbon');
    expect(payload.prompt).not.toContain('紫色头发');
    expect(payload.prompt).not.toContain('红色兔耳发饰');
    expect(snapshot.renderContext.characters[0]?.name).toBe('安柏');
    expect(snapshot.renderContext.sceneNegativePrompt).not.toContain('紫色头发');
  });
});
