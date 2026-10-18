import { expect, it } from 'vitest';
import { mergeNpcWriteBack, mergeSettlementSliceWriteBack } from '@/utils/npcWriteBack';
import type { NPC记录 } from '@/models/npc';
import { resetNpcEnglishAfterManualEdit } from '@/utils/fixedNpcImageBasics';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { preflightTeyvatTurn } from '@/services/teyvatTurnTransaction';
import { 归一化NPC记录列表 } from '@/models/npc';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';
import { readImageCharacterFacts } from '@/utils/imageCharacterFacts';
const englishFacts = { schemaVersion: 1 as const, sourceKey: '{"name":"安柏","gender":"女","appearance":"棕发","outfit":"骑士常服"}', preparedAt: 1, facts: { language: 'en' as const, name: 'Amber', gender: 'female', appearance: 'brown hair', outfit: 'knight uniform' } };
it('keeps established Chinese and English basics through phone and post-settlement background merges', () => {
  const base = { id: 'amber', 姓名: '安柏', 性别: '女', 外貌: '棕发', 穿着: '骑士常服', 性格: '热情', 好感度: 10, 同行记忆: [], 图像档案: { englishFacts } } as unknown as NPC记录;
  const next = { ...base, 外貌: '黑发', 穿着: '被后台改掉的常服', 好感度: 12, 图像档案: { englishFacts: { ...englishFacts, facts: { ...englishFacts.facts, name: 'Different Amber' } } } };
  for (const row of [mergeNpcWriteBack({ start: [base], next: [next], current: [base] }).records[0], mergeSettlementSliceWriteBack({ base: [base], next: [next], current: [base] }).records[0]]) {
    expect(row).toMatchObject({ 外貌: '棕发', 穿着: '骑士常服', 好感度: 12, 图像档案: { englishFacts } });
  }
});
it('rejects an AI command that rewrites established basics and lets explicit player editing invalidate only the translation', () => {
  const state = createEmptyTeyvatGameState(); state.NPC = normalizeTeyvatNpcRecords([{ id: 'amber', 姓名: '安柏', gender: '女', appearance: '棕发', clothing: '骑士常服', visualArchive: { slotImages: { courier: '/fixture.webp' }, englishFacts } }]);
  const result = preflightTeyvatTurn(state, [{ root: 'NPC', action: 'set', path: '[id=amber].appearance', value: '黑发', evidence: '头发变黑' }], { trustedEvidence: ['头发变黑'] });
  expect(result.status).toBe('rejected'); expect(result.errors[0]?.code).toBe('IMMUTABLE_PROFILE_FIELD'); expect(state.NPC[0]!.appearance).toBe('棕发');
  const manual = resetNpcEnglishAfterManualEdit(state.NPC[0]!, { ...state.NPC[0]!, appearance: '栗色长发' });
  expect(manual.visualArchive.englishFacts).toBeUndefined(); expect(manual.visualArchive.slotImages.courier).toBe('/fixture.webp');
});
it('protects recorded Chinese basics before the first English preparation without preventing initial blank-field completion', () => {
  const base = { id: 'amber-cn', 姓名: '安柏', 性别: '女', 外貌: '棕色长发', 穿着: '已建档常服', 性格: '已建档性格', 好感度: 10, 同行记忆: [], 外貌档案: { 发色: { value: '棕色', source: 'canon' as const } } } as unknown as NPC记录;
  const produced = { ...base, 外貌: '黑色长发', 穿着: '被后台改写', 性格: '被后台改写', 好感度: 12, 外貌档案: { 发色: { value: '黑色', source: 'narrative' as const } } };
  for (const row of [mergeNpcWriteBack({ start: [base], next: [produced], current: [base] }).records[0], mergeSettlementSliceWriteBack({ base: [base], next: [produced], current: [base] }).records[0], enrichNpcArchives([base], { nsfwEnabled: false, maleNsfwArchiveEnabled: false }).records[0]]) {
    expect(row).toMatchObject({ 外貌: '棕色长发', 穿着: '已建档常服', 性格: '已建档性格', 外貌档案: { 发色: { value: '棕色', source: 'canon' } } });
  }
  const blank = { ...base, 外貌: undefined, 外貌档案: undefined };
  expect(enrichNpcArchives([blank], { nsfwEnabled: false, maleNsfwArchiveEnabled: false }).records[0]?.外貌).toBeTruthy();
});
it('does not replace already recorded base facts while normalizing an NPC without English', () => {
  const source = { id: 'amber-cn', 姓名: '安柏', gender: '女', appearance: '棕色长发', clothing: '已建档常服', personality: '已建档性格', appearanceFacts: { 发色: { value: '棕色', source: 'canon' } } };
  const teyvat = normalizeTeyvatNpcRecords([source])[0]!;
  expect(teyvat).toMatchObject({ appearance: '棕色长发', personality: '已建档性格', appearanceFacts: { 发色: { value: '棕色', source: 'canon' } } });
  expect(normalizeTeyvatNpcRecords([teyvat])[0]).toEqual(teyvat);
  const legacy = 归一化NPC记录列表([{ id: source.id, 姓名: source.姓名, 外貌: source.appearance, 外貌档案: source.appearanceFacts }])[0]!;
  expect(legacy.外貌).toBe('棕色长发'); expect(legacy.外貌档案?.发色?.value).toBe('棕色');
});
it('rejects narrative rewrites of an established base field before English has ever been prepared', () => {
  const state = createEmptyTeyvatGameState(); state.NPC = normalizeTeyvatNpcRecords([{ id: 'amber-cn', 姓名: '安柏', appearance: '棕色长发' }]);
  const result = preflightTeyvatTurn(state, [{ root: 'NPC', action: 'set', path: '[id=amber-cn].appearance', value: '黑色长发', evidence: '头发变黑' }], { trustedEvidence: ['头发变黑'] });
  expect(result.status).toBe('rejected'); expect(result.errors[0]?.code).toBe('IMMUTABLE_PROFILE_FIELD');
});
it('does not reuse an English cache containing measurements after the existing eligibility gate blocks them', () => {
  const sourceKey = '{"name":"档案测试旅人","gender":"女","appearance":"棕发","appearanceDetails":{"三围":{"value":"90/60/90 cm","source":"manual"}}}';
  const base = { id: 'profile-test', 姓名: '档案测试旅人', 性别: '女', 外貌: '棕发', 好感度: 10, 同行记忆: [], 外貌档案: { 三围: { value: '90/60/90 cm', source: 'manual' } }, NSFW档案: { 年龄确认: 'adult', 年龄确认来源: 'manual' }, 图像档案: { englishFacts: { schemaVersion: 1, sourceKey, preparedAt: 1, facts: { language: 'en', name: 'Profile Test Traveler', gender: 'female', appearance: 'brown hair', appearanceDetails: { 三围: { value: '90/60/90 cm', source: 'manual' } } } } } } as unknown as NPC记录;
  expect(readImageCharacterFacts(base).language).toBe('en');
  const produced = { ...base, NSFW档案: { ...base.NSFW档案!, 年龄确认: 'minor_blocked' as const } };
  const row = mergeNpcWriteBack({ start: [base], next: [produced], current: [base] }).records[0]!;
  expect(row.NSFW档案?.年龄确认).toBe('minor_blocked'); expect(readImageCharacterFacts(row).appearanceDetails?.三围).toBeUndefined(); expect(JSON.stringify(readImageCharacterFacts(row))).not.toContain('90/60/90');
});
