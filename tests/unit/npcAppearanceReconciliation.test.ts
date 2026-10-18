import { describe, expect, it } from 'vitest';
import { 创建NPC记录, 归一化NPC记录列表 } from '@/models/npc';
import type { NPC外貌档案 } from '@/models/npc';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { setNpcAppearanceFact, applyNpcAppearanceEstimate } from '@/services/ai/npcAppearanceEstimate';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';
import { readImageCharacterFacts } from '@/utils/imageCharacterFacts';
import { mergeSettlementSliceWriteBack } from '@/utils/npcWriteBack';
import { omitNpcAppearanceMeasurements, reconcileNpcAppearance, reconcileNpcAppearanceParagraphs } from '@/utils/npcAppearanceReconciliation';
import { readFileSync } from 'node:fs';
import { getCanonicalArchiveBaselineAge } from '@/utils/npcArchiveBaseline';

const facts: NPC外貌档案 = {
  发色: { value: '棕色', source: 'manual' }, 瞳色: { value: '绿色', source: 'narrative' },
  身高: { value: '168 cm', source: 'ai_estimate' }, 体重: { value: '55 kg', source: 'manual' },
  三围: { value: '90/60/90 cm', source: 'manual' },
};
const overview = '银白色长卷发，金色瞳孔，身高 172 cm，体重 60 kg，三围 88/62/89 cm；戴银白色帽子与金色耳环，穿蓝色长裙。';
const makeNpc = () => ({ ...创建NPC记录({ 姓名: '测试旅人', 初见回合: 1, 性别: '女', NSFW档案: { 年龄确认: 'adult', 年龄确认来源: 'manual' } }), id: 'appearance-test', 外貌: overview, 外貌档案: facts });
function checkOverview(text: string | undefined) {
  expect(text).toContain('棕色长卷发'); expect(text).toContain('绿色瞳孔');
  expect(text).toContain('168 cm'); expect(text).toContain('55 kg'); expect(text).toContain('90/60/90 cm');
  expect(text).not.toMatch(/172 cm|60 kg|88\/62\/89/);
  expect(text).toContain('银白色帽子与金色耳环'); expect(text).toContain('蓝色长裙');
}
describe('structured appearance reconciliation boundaries', () => {
  it('corrects real hair without changing the colors of a hair crown, pin or cord', () => {
    const text = '银白色长发，银白色发冠，金色发簪，蓝色发绳。';
    expect(reconcileNpcAppearance(text, facts)).toBe('棕色长发，银白色发冠，金色发簪，蓝色发绳。');
  });
  it('preserves crown pin and cord colors at actual normalization manual edit image and live write boundaries', () => {
    const raw = { ...makeNpc(), 外貌: '银白色长发，银白色发冠，金色发簪，蓝色发绳。' };
    const expected = '棕色长发，银白色发冠，金色发簪，蓝色发绳。';
    const base = { ...raw, 外貌: '旧外貌' };
    const live = { ...base, 穿着: '玩家衣服' };
    for (const result of [归一化NPC记录列表([raw])[0]?.外貌, setNpcAppearanceFact(raw, '发色', '棕色').外貌, readImageCharacterFacts(raw).appearance]) expect(result).toBe(expected);
    // Base profiles are now fixed: background write-back may not replace an established overview.
    expect(mergeSettlementSliceWriteBack({ base: [base], next: [raw], current: [live] }).records[0]?.外貌).toBe('旧外貌');
  });
  it('keeps an explicit appearance paragraph scope across sentences but not across a newline into a story', () => {
    const text = '外貌：银白色长发。金色眼眸，戴银白色帽子。\n金色长发的陌生少女走过街角。';
    expect(reconcileNpcAppearanceParagraphs(text, facts, 'mixed')).toBe('外貌：棕色长发。绿色眼眸，戴银白色帽子。\n金色长发的陌生少女走过街角。');
  });
  it('conservatively protects an ambiguous new subject inside a labeled paragraph', () => {
    const text = '外貌：银白色长发。金色长发的陌生少女走过街角。';
    expect(reconcileNpcAppearanceParagraphs(text, facts, 'mixed')).toBe('外貌：棕色长发。金色长发的陌生少女走过街角。');
  });
  it('reconciles whole compound colors without leaving a conflicting prefix', () => {
    const appearance = '红棕色长发，靛蓝色眼眸，戴红棕色帽子。';
    expect(reconcileNpcAppearance(appearance, { 发色: { value: '白色', source: 'manual' }, 瞳色: { value: '绿色', source: 'manual' } })).toBe('白色长发，绿色眼眸，戴红棕色帽子。');
    expect(reconcileNpcAppearance('雾蓝色长发，雾蓝色眼眸。', facts)).toBe('雾蓝色长发，雾蓝色眼眸。');
  });
  it('handles the actual canonical sourced color descriptions while retaining overview hairstyle and accessory', () => {
    const normalized = 归一化NPC记录列表([{ ...makeNpc(), 姓名: '丽莎', 外貌: '银白色长卷发，金色瞳孔，戴银白色帽子。', 外貌档案: undefined }])[0]!;
    expect(normalized.外貌).not.toContain('银白色长卷发'); expect(normalized.外貌).not.toContain('金色瞳孔');
    expect(normalized.外貌).toContain('长卷发'); expect(normalized.外貌).toContain('戴银白色帽子');
    expect(normalized.外貌档案?.发色?.source).toBe('canon');
  });
  it('corrects labeled features with ordinary Chinese copulas and does not touch accessory colors', () => {
    expect(reconcileNpcAppearance('发色为黑色，瞳色是蓝色；身高为172厘米，体重约60千克；蓝色发带，黑色发卡。', facts)).toBe('发色为棕色，瞳色是绿色；身高为168 cm，体重约55 kg；蓝色发带，黑色发卡。');
  });
  it('retains decimal measurements when projecting overview sentences from mixed public text', () => {
    expect(reconcileNpcAppearanceParagraphs('身高 172.5 cm，体重 60.5 kg。她与金发的琴共事。', facts)).toBe('身高 168 cm，体重 55 kg。她与金发的琴共事。');
  });
  it('omits disallowed measurements with Chinese copulas rather than leaking them through prose', () => {
    expect(omitNpcAppearanceMeasurements('身高 168 cm；三围为90/60/90 cm。')).not.toContain('90/60/90');
  });
  it('keeps the exact baseline age lookup and a one-way runtime dependency', () => {
    expect(getCanonicalArchiveBaselineAge('Lisa')).toBe('adult'); expect(getCanonicalArchiveBaselineAge('荧')).toBe('unknown');
    expect(getCanonicalArchiveBaselineAge('丽莎的学徒')).toBeUndefined();
    const baseline = readFileSync('utils/npcArchiveBaseline.ts', 'utf8');
    const factsSource = readFileSync('services/npcAppearanceFacts.ts', 'utf8');
    const pure = readFileSync('utils/npcAppearanceReconciliation.ts', 'utf8');
    expect(factsSource).not.toMatch(/from ['"]@\/utils\/npcArchiveEnrichment/);
    expect(baseline).not.toMatch(/from ['"]@\/services\//);
    expect(pure).not.toMatch(/^import (?!type )/mu);
  });
  it('legacy normalization reconciles explicit features without replacing hairstyle or accessories', () => {
    const npc = 归一化NPC记录列表([makeNpc()])[0]!; checkOverview(npc.外貌);
    expect(npc.外貌档案).toEqual(facts); expect(归一化NPC记录列表([npc])[0]?.外貌).toBe(npc.外貌);
  });
  it('reconciles the final combined facts after legacy identity merging', () => {
    const base = { ...makeNpc(), 外貌档案: { 身高: facts.身高 }, 外貌: '银白色长卷发，身高 172 cm，戴银白色帽子。' };
    const incoming = { ...makeNpc(), 外貌: undefined, 外貌档案: { 发色: facts.发色 } };
    const normalized = 归一化NPC记录列表([base, incoming]);
    expect(normalized).toHaveLength(1); expect(normalized[0]?.外貌).toContain('棕色长卷发');
    expect(normalized[0]?.外貌).toContain('168 cm'); expect(normalized[0]?.外貌).toContain('银白色帽子');
  });
  it('teyvat normalization uses the same permitted recorded facts', () => {
    const npc = normalizeTeyvatNpcRecords([{ id: 'appearance-test', 姓名: '测试旅人', gender: '女', appearance: overview, appearanceFacts: facts, matureArchive: { ageConfirmation: 'adult', ageConfirmationSource: 'manual' } }])[0]!;
    checkOverview(npc.appearance); expect(npc.appearanceFacts).toEqual(facts);
  });
  it('manual edits and estimates reconcile at write time and keep their sources', () => {
    const manual = setNpcAppearanceFact(makeNpc(), '身高', '169 cm');
    expect(manual.外貌).toContain('169 cm'); expect(manual.外貌档案?.身高?.source).toBe('manual');
    const estimated = applyNpcAppearanceEstimate({ ...makeNpc(), 外貌档案: undefined }, facts);
    checkOverview(estimated.外貌); expect(estimated.外貌档案?.身高?.source).toBe('ai_estimate');
  });
  it('archive enrichment and image projection cannot reintroduce a conflicting overview', () => {
    checkOverview(enrichNpcArchives([makeNpc()], { nsfwEnabled: false, maleNsfwArchiveEnabled: false }).records[0]?.外貌);
    checkOverview(readImageCharacterFacts(makeNpc()).appearance);
  });
  it('does not invent absent values or modify unrelated numbers and colors', () => {
    const raw = { ...makeNpc(), 外貌: '银白色帽子，金色耳环；背包高 172 cm，重 60 kg。', 外貌档案: { 发色: facts.发色 } };
    expect(readImageCharacterFacts(raw).appearance).toBe(raw.外貌);
  });
  it('filters gated measurements from image outfit facts while retaining clothing and permitted adult measurements', () => {
    const unknown = { ...makeNpc(), NSFW档案: undefined, 穿着: '蓝色长裙，三围90/60/90 cm' };
    const protectedNpc = { ...unknown, 姓名: '可莉', NSFW档案: { 年龄确认: 'adult' as const, 年龄确认来源: 'manual' as const } };
    for (const record of [unknown, protectedNpc]) {
      const projected = readImageCharacterFacts(record); expect(projected.outfit).toContain('蓝色长裙'); expect(projected.outfit).not.toContain('90/60/90');
    }
    expect(readImageCharacterFacts({ ...makeNpc(), 穿着: unknown.穿着 }).outfit).toBe(unknown.穿着);
  });
  it('reconciles a settlement delta against the live manually edited fact without losing concurrent profile fields', () => {
    const base = makeNpc();
    const live = { ...base, 外貌档案: { ...facts, 身高: { value: '169 cm', source: 'manual' as const } }, 穿着: '玩家新衣服' };
    const produced = { ...base, 外貌: '银白色长卷发，身高 172 cm；戴银白色帽子。', 介绍: '新介绍' };
    const result = mergeSettlementSliceWriteBack({ base: [base], next: [produced], current: [live] }).records[0]!;
    expect(result.外貌).toContain('169 cm'); expect(result.穿着).toBe('玩家新衣服'); expect(result.介绍).toBe('新介绍');
  });
});
