import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareEnglishImageCharacter, prepareEnglishImagePrompts, prepareEnglishProfileCache } from '@/services/imageCharacterEnglish';
import type { API配置项 } from '@/models/settings';
import type { EnglishImageCharacterFacts } from '@/models/imageCharacterEnglish';
const { model, store } = vi.hoisted(() => ({ model: vi.fn(), store: new Map<string, unknown>() }));
vi.mock('@/services/ai/chatCompletionClient', () => ({ chatCompletionNonStream: model }));
vi.mock('@/services/dbService', () => ({ loadSetting: async (key: string) => store.get(key) ?? null, saveSetting: async (key: string, value: unknown) => { store.set(key, value); } }));
const config = { id: 'text', model: 'test', provider: 'openai' } as API配置项;
const facts = { name: '测试人物', gender: '女', appearance: '棕发绿眼', appearanceDetails: { 身高: { value: '168 cm', source: 'manual' as const } } };
const result = { name: 'Test Person', gender: 'female', appearance: 'brown hair, green eyes', appearanceDetails: { 身高: { value: '168 cm' } } };
beforeEach(() => { model.mockReset(); store.clear(); });
describe('explicit English image fact preparation', () => {
  it('persists translated visible facts and reuses them without another model call', async () => {
    model.mockResolvedValue(JSON.stringify(result));
    const first = await prepareEnglishImageCharacter(facts, config);
    expect(first.facts.language).toBe('en'); expect(first.facts.name).toBe('Test Person');
    expect(first.facts.appearanceDetails?.身高?.source).toBe('manual');
    expect(facts.name).toBe('测试人物'); expect(store.size).toBe(1);
    expect((await prepareEnglishImageCharacter(facts, config)).facts).toEqual(first.facts);
    expect(model).toHaveBeenCalledTimes(1);
  });
  it('invalidates stale sources and rejects omitted facts or invented measurements', async () => {
    model.mockResolvedValue(JSON.stringify({ ...result, appearanceDetails: { 身高: { value: '170 cm' } } }));
    await expect(prepareEnglishImageCharacter(facts, config)).rejects.toThrow('外貌细项');
    expect(store.size).toBe(0);
    model.mockResolvedValue(JSON.stringify(result)); await prepareEnglishImageCharacter(facts, config);
    await prepareEnglishImageCharacter({ ...facts, appearance: '银发绿眼' }, config);
    expect(model).toHaveBeenCalledTimes(3);
  });
  it('blocks uncached non-English facts without a text model and honors cancellation', async () => {
    await expect(prepareEnglishImageCharacter(facts, null)).rejects.toThrow('英文');
    const controller = new AbortController(); controller.abort();
    await expect(prepareEnglishImageCharacter(facts, config, controller.signal)).rejects.toThrow();
    expect(model).not.toHaveBeenCalled(); expect(store.size).toBe(0);
  });
  it('does not pay twice for concurrent preparation within the same operation', async () => {
    model.mockResolvedValue(JSON.stringify(result));
    const [first, second] = await Promise.all([prepareEnglishImageCharacter(facts, config), prepareEnglishImageCharacter(facts, config)]);
    expect(first).toEqual(second); expect(model).toHaveBeenCalledTimes(1);
  });
  it('rejects changed units and traveler height, not just changed digits', async () => {
    model.mockResolvedValue(JSON.stringify({ ...result, appearanceDetails: { 身高: { value: '168 kg' } } }));
    await expect(prepareEnglishImageCharacter(facts, config)).rejects.toThrow('外貌细项');
    model.mockResolvedValue(JSON.stringify({ name: 'Test Person', profileHeight: '170 cm' }));
    await expect(prepareEnglishImageCharacter({ name: '测试人物', profileHeight: '168厘米' }, config)).rejects.toThrow('身高');
    expect(store.size).toBe(0);
  });
  it('replaces source fact blocks and translates a Chinese stable anchor without changing identity', async () => {
    model.mockResolvedValueOnce(JSON.stringify(result)).mockResolvedValueOnce('brown hair, green eyes, red ribbon');
    const prepared = await prepareEnglishImagePrompts({ prompt: 'character name: 测试人物\ngender: 女\nappearance: 棕发绿眼\n棕发绿眼，红发带, smiling', negative: 'watermark',
      characters: [{ name: facts.name, facts, visualPrompt: '', anchorPrompt: '棕发绿眼，红发带' }] }, config);
    expect(prepared.prompt).toContain('Test Person');
    expect(prepared.prompt).toContain('red ribbon');
    expect(prepared.prompt).not.toContain('测试人物');
    expect(prepared.prompt).not.toContain('棕发绿眼');
    expect(prepared.characters[0]?.facts?.appearanceDetails?.身高?.source).toBe('manual');
    expect(prepared.caches[0]?.sourceKey).toBe(JSON.stringify(facts));
  });
  it.each(['brown hair, 170 cm tall', 'brown hair, weight: 55 kg', 'brown hair, 90/60/90 cm'])('rejects invented measurements inside overview: %s', async appearance => {
    model.mockResolvedValue(JSON.stringify({ name: 'Test Person', appearance }));
    await expect(prepareEnglishImageCharacter({ name: '测试人物', appearance: '棕发' }, config)).rejects.toThrow('校验');
    expect(store.size).toBe(0);
  });
  it('rejects changed measurements inside recorded outfit prose', async () => {
    model.mockResolvedValue(JSON.stringify({ name: 'Test Person', outfit: 'red coat, 55 kg' }));
    await expect(prepareEnglishImageCharacter({ name: '测试人物', outfit: '红外套' }, config)).rejects.toThrow('校验');
  });
  it.each([['1.68米', '1.68 m'], ['1.68 m', '1.68 meters'], ['168公分', '168 centimetres'], ['120磅', '120 lbs']])('preserves equivalent unit spelling %s -> %s', async (source, translated) => {
    model.mockResolvedValue(JSON.stringify({ name: 'Test Person', profileHeight: translated }));
    expect((await prepareEnglishImageCharacter({ name: '测试人物', profileHeight: source }, config)).facts.profileHeight).toBe(translated);
  });
  it.each([
    (cache: EnglishImageCharacterFacts) => ({ ...cache, appearance: 'brown hair, 170 cm tall' }),
    (cache: EnglishImageCharacterFacts) => ({ ...cache, outfit: 'new invented coat' }),
    (cache: EnglishImageCharacterFacts) => ({ ...cache, appearanceDetails: { 身高: { value: '170 cm', source: 'manual' as const } } }),
  ])('does not trust restored fact caches that bypass source validation', async mutate => {
    model.mockResolvedValue(JSON.stringify(result));
    const first = await prepareEnglishImageCharacter(facts, config);
    const key = [...store.keys()][0]!;
    store.set(key, { ...first, facts: { ...mutate(first.facts), language: 'en' } });
    await expect(prepareEnglishImageCharacter(facts, null)).rejects.toThrow('英文');
    expect(model).toHaveBeenCalledTimes(1);
  });
  it.each(['', 'brown hair, 170 kg'])('does not reuse invalid standalone anchor cache: %s', async badEnglish => {
    model.mockResolvedValueOnce(JSON.stringify(result)).mockResolvedValueOnce('brown hair, 170 cm');
    const input = { prompt: 'portrait', negative: '', characters: [{ name: facts.name, facts, visualPrompt: '', anchorPrompt: '棕发，170厘米' }] };
    await prepareEnglishImagePrompts(input, config);
    for (const [key, value] of store) if ((value as { source?: string }).source) store.set(key, { source: '棕发，170厘米', english: badEnglish });
    await expect(prepareEnglishImagePrompts(input, null)).rejects.toThrow('锚点');
  });
  it('repairs an empty profile anchor rather than treating its fingerprint as prepared', async () => {
    model.mockResolvedValueOnce(JSON.stringify(result)).mockResolvedValueOnce('brown hair, 170 cm');
    const anchors = { prompt: '棕发，170厘米' };
    const first = await prepareEnglishProfileCache(facts, config, anchors);
    const key = [...store.entries()].find(([, value]) => (value as { sourceKey?: string }).sourceKey === first.sourceKey)![0];
    store.set(key, { ...first, anchorPrompt: '' });
    expect((await prepareEnglishProfileCache(facts, null, anchors)).anchorPrompt).toBe('brown hair, 170 cm');
  });
  it('does not share in-flight translations across different credentials', async () => {
    let finish!: (value: string) => void;
    model.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    const first = prepareEnglishImageCharacter(facts, { ...config, apiKey: 'isolated-test-key-a' });
    await Promise.resolve(); await Promise.resolve();
    model.mockResolvedValue(JSON.stringify(result));
    const second = prepareEnglishImageCharacter(facts, { ...config, apiKey: 'isolated-test-key-b' });
    await Promise.resolve(); await Promise.resolve();
    finish(JSON.stringify(result));
    await Promise.all([first, second]);
    expect(model).toHaveBeenCalledTimes(2);
  });
  it('deduplicates identical credentials but keeps independent cancellation signals separate', async () => {
    model.mockResolvedValue(JSON.stringify(result));
    const signal = new AbortController().signal;
    await Promise.all([prepareEnglishImageCharacter(facts, config, signal), prepareEnglishImageCharacter(facts, { ...config }, signal)]);
    expect(model).toHaveBeenCalledTimes(1);
    store.clear(); model.mockClear();
    await Promise.all([prepareEnglishImageCharacter(facts, config, new AbortController().signal), prepareEnglishImageCharacter(facts, config, new AbortController().signal)]);
    expect(model).toHaveBeenCalledTimes(2);
  });
  it('rejects omitted and empty fields when loading a cache without mutating its source', async () => {
    model.mockResolvedValue(JSON.stringify(result));
    const first = await prepareEnglishImageCharacter(facts, config);
    const key = [...store.keys()][0]!;
    store.set(key, { ...first, facts: { ...first.facts, appearance: '' } });
    await expect(prepareEnglishImageCharacter(facts, null)).rejects.toThrow('英文');
    expect(facts.appearance).toBe('棕发绿眼');
  });
});
