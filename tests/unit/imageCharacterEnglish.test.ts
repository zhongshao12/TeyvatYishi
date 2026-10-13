import { describe, expect, it } from 'vitest';
import { normalizeTravelerProfile, normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { formatImageCharacterFacts, readImageCharacterFacts } from '@/utils/imageCharacterFacts';
import { 创建NPC记录, 归一化NPC记录列表 } from '@/models/npc';
import { normalizeImageCharacterEnglishCache } from '@/models/imageCharacterEnglish';
import { buildNpcImagePrompt, buildSceneImagePrompt, readImagePromptCharacter } from '@/utils/imagePromptRules';
import { 创建默认游戏设置 } from '@/models/settings';

const source = { 姓名: '测试角色', 性别: '女' as const, 外貌: '棕发、琥珀色眼睛', 穿着: '红色外套', 外貌档案: { 身高: { value: '168 cm', source: 'manual' as const } } };
const english = { schemaVersion: 1 as const, sourceKey: JSON.stringify(readImageCharacterFacts(source)), preparedAt: 1,
  facts: { language: 'en' as const, name: 'Test Character', gender: 'female', appearance: 'brown hair, amber eyes', outfit: 'red coat', appearanceDetails: { 身高: { value: '168 cm', source: 'manual' as const } } } };

describe('persisted English visible image facts', () => {
  it('consumes English facts without reintroducing Chinese labels or Chinese identity', () => {
    const facts = readImageCharacterFacts({ ...source, 图像档案: { englishFacts: english } } as never);
    const prompt = formatImageCharacterFacts(facts);
    expect(prompt).toContain('character name: Test Character');
    expect(prompt).toContain('height: 168 cm');
    expect(prompt).not.toMatch(/[\u3400-\u9fff]/);
  });
  it('preserves a separately stored English cache in traveler save normalization', () => {
    const traveler = { 姓名: 'Test Character', 性别: 'female', 外貌: 'brown hair', visualArchive: { englishFacts: english } };
    expect(normalizeTravelerProfile(traveler).visualArchive).toHaveProperty('englishFacts');
  });
  it('preserves a separately stored English cache in NPC save normalization', () => {
    const npc = { ...source, gender: source.性别, appearance: source.外貌, appearanceFacts: source.外貌档案, clothing: source.穿着, visualArchive: { slotImages: {}, englishFacts: english } };
    expect(normalizeTeyvatNpcRecords([npc])[0]?.visualArchive).toHaveProperty('englishFacts');
  });
  it('keeps a cache-only NPC archive through legacy normalization', () => {
    const npc = 归一化NPC记录列表([{ ...source, 初见回合: 1, 图像档案: { englishFacts: english } }])[0]!;
    expect(npc.图像档案?.englishFacts?.facts.name).toBe('Test Character');
    expect(npc.姓名).toBe(source.姓名);
  });
  it.each([
    { ...english.facts, appearance: 'brown hair, 170 cm tall' },
    { ...english.facts, appearanceDetails: { 身高: { value: '170 cm', source: 'manual' as const } } },
    { ...english.facts, appearanceDetails: { 身高: { value: '168 cm', source: 'ai_estimate' as const } } },
    { ...english.facts, profileHeight: '170 cm' },
  ])('rejects imported caches with numeric, provenance or absent-field changes', facts => {
    expect(normalizeImageCharacterEnglishCache({ ...english, facts })).toBeUndefined();
    expect(readImageCharacterFacts({ ...source, 图像档案: { englishFacts: { ...english, facts } } })).toEqual(readImageCharacterFacts(source));
  });
  it('uses prepared anchors throughout actual portrait and scene builders', () => {
    const npc = { ...创建NPC记录({ 姓名: '测试角色', 初见回合: 1 }), ...source,
      图像档案: { englishFacts: { ...english, anchorSourceKey: JSON.stringify({ prompt: 'character anchor positive prompt: 棕发，红发带', negative: '紫色头发' }),
        anchorPrompt: 'character anchor positive prompt: brown hair, red ribbon', anchorNegative: 'purple hair' },
        角色锚点: { 正面提示词: '棕发，红发带', 负面提示词: '紫色头发' } } };
    const rules = 创建默认游戏设置().文生图系统.rules;
    const portrait = buildNpcImagePrompt({ npc, mode: 'avatar', rules });
    const scene = buildSceneImagePrompt({ text: 'standing by a fountain', mode: 'scene', rules, presentNpcs: [npc] });
    for (const built of [portrait, scene]) {
      expect(built.prompt).toContain('red ribbon');
      expect(built.prompt).not.toContain('红发带');
      expect(built.negative).toContain('purple hair');
      expect(built.negative).not.toContain('紫色头发');
    }
    expect(npc.姓名).toBe(source.姓名);
  });
  it.each(['', 'brown hair, 170 kg'])('falls back when imported anchor content fails source validation: %s', anchorPrompt => {
    const npc = { ...source, 图像档案: { englishFacts: { ...english, anchorSourceKey: JSON.stringify({ prompt: 'character anchor positive prompt: 棕发，170厘米', negative: '' }), anchorPrompt },
      角色锚点: { 正面提示词: '棕发，170厘米' } } };
    expect(readImagePromptCharacter(npc).anchorPrompt).toContain('棕发');
  });
});
