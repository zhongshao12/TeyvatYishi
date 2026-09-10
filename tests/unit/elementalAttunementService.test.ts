import { describe, expect, it } from 'vitest';
import { createEmptyTravelerProfile, normalizeTravelerProfile } from '@/models/teyvat/character';
import { createEmptyTeyvatWorld } from '@/models/teyvat/world';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { normalizeConversationLog } from '@/models/teyvat/runtimeSlices';
import { OFFICIAL_OPENING_PRESETS } from '@/models/teyvat/opening';
import { createTeyvatGameFromOpeningPreset } from '@/services/teyvatOpeningFactory';
import { buildNewGameOpeningPayload } from '@/components/features/NewGame/NewGameWizard';
import { applyLegacyNpcRecords, applyLegacyWorldState, mapTeyvatNpcsToLegacy } from '@/hooks/useGameState';
import { migratePartialTeyvatSave } from '@/compat/legacy-hsr/migrate';
import {
  advanceElementalMastery,
  applyElementalEchoResult,
  applyTravelerSkillMastery,
  canInviteElementalEcho,
  ELEMENTAL_ECHO_INVITE_MASTERY,
  ELEMENTAL_ECHO_MASTERY_GAIN,
  enterElementalEcho,
  setPrimaryElement,
  unlockElement,
} from '@/services/elementalAttunementService';

describe('elemental attunement service', () => {
  it('normalizes talent element links without persisting unknown keys', () => {
    const normalized = normalizeTravelerProfile({
      天赋: [{
        id: 'gust',
        名称: '风涡剑',
        类别: 'elemental_skill',
        等级: 2,
        说明: '牵引附近敌人。',
        关联元素: 'anemo',
        hiddenPath: 'harmony',
      }],
    });

    expect(normalized.天赋[0]).toEqual({
      id: 'gust',
      名称: '风涡剑',
      类别: 'elemental_skill',
      等级: 2,
      说明: '牵引附近敌人。',
      关联元素: 'anemo',
    });
  });

  it('normalizes hidden HSR talent links to an empty element', () => {
    const normalized = normalizeTravelerProfile({
      天赋: [{
        id: 'hidden',
        名称: '旧契约',
        类别: 'passive',
        等级: 1,
        说明: '不应保留旧值。',
        关联元素: 'harmony',
      }],
    });

    expect((normalized.天赋[0] as { 关联元素?: string }).关联元素).toBe('');
  });

  it('unlocks anemo through traveler resonance without restoring a path list', () => {
    const traveler = createEmptyTravelerProfile();

    const unlocked = unlockElement(traveler, 'anemo', {
      source: 'traveler_resonance',
      unlockedAt: '1日 08:00',
    });

    expect(unlocked.元素共鸣).toEqual([{
      element: 'anemo',
      source: 'traveler_resonance',
      mastery: 0,
      unlocked: true,
      unlockedAt: '1日 08:00',
      notes: '',
    }]);
    expect(unlocked).not.toHaveProperty('命途列表');
    expect(traveler.元素共鸣).toEqual([]);
  });

  it('clamps mastery to zero and one hundred without mutating the input', () => {
    const traveler = unlockElement(createEmptyTravelerProfile(), 'anemo', {
      source: 'traveler_resonance',
      unlockedAt: '1日 08:00',
    });

    const capped = advanceElementalMastery(traveler, 'anemo', 120);
    const floored = advanceElementalMastery(capped, 'anemo', -250);

    expect(capped.元素共鸣[0].mastery).toBe(100);
    expect(floored.元素共鸣[0].mastery).toBe(0);
    expect(traveler.元素共鸣[0].mastery).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite mastery delta %s without mutation',
    (delta) => {
      const traveler = unlockElement(createEmptyTravelerProfile(), 'anemo', {
        source: 'traveler_resonance',
        unlockedAt: '1日 08:00',
      });

      expect(() => advanceElementalMastery(traveler, 'anemo', delta)).toThrowError('INVALID_MASTERY_DELTA');
      expect(traveler.元素共鸣[0].mastery).toBe(0);
      expect(Number.isFinite(traveler.元素共鸣[0].mastery)).toBe(true);
    },
  );

  it('skill mastery only accrues to unlocked elements and dedupes repeats', () => {
    const traveler = unlockElement(createEmptyTravelerProfile(), 'anemo', {
      source: 'traveler_resonance',
      unlockedAt: '1日 08:00',
    });

    // 旅行者用了风、火（火未解锁），且风重复出现 —— 只有风 +2，火忽略。
    const result = applyTravelerSkillMastery(traveler, ['anemo', 'pyro', 'anemo'], 2);

    expect(result.gains).toEqual(['anemo']);
    expect(result.traveler.元素共鸣[0].mastery).toBe(2);
    // 未解锁的火不应被创建出共鸣条目。
    expect(result.traveler.元素共鸣).toHaveLength(1);
    // 原对象不可变。
    expect(traveler.元素共鸣[0].mastery).toBe(0);
  });

  it('rejects selecting a locked element as primary', () => {
    const traveler = createEmptyTravelerProfile();

    expect(() => setPrimaryElement(traveler, 'geo')).toThrowError('ELEMENT_NOT_UNLOCKED');
    expect(traveler.主元素).toBe('');
  });

  it('moves an elemental echo from invitation to active and applies its result immutably', () => {
    const traveler = unlockElement(createEmptyTravelerProfile(), 'hydro', {
      source: 'traveler_resonance',
      unlockedAt: '2日 12:00',
    });
    const world = { ...createEmptyTeyvatWorld(), 元素回响邀请: 'hydro' as const };

    const entered = enterElementalEcho(world);
    const completed = applyElementalEchoResult(traveler, entered, 'hydro', 35);

    expect(entered).toMatchObject({ 元素回响邀请: '', 进行中元素回响: 'hydro' });
    expect(world).toMatchObject({ 元素回响邀请: 'hydro', 进行中元素回响: '' });
    expect(completed.world).toMatchObject({ 元素回响邀请: '', 进行中元素回响: '' });
    expect(completed.traveler.元素共鸣[0].mastery).toBe(35);
    expect(entered.进行中元素回响).toBe('hydro');
    expect(traveler.元素共鸣[0].mastery).toBe(0);
  });

  it('uses one threshold for a beneficial echo and does not re-invite at full mastery', () => {
    const unlocked = unlockElement(createEmptyTravelerProfile(), 'hydro', {
      source: 'traveler_resonance',
      unlockedAt: '2日 12:00',
    });
    const at74 = advanceElementalMastery(unlocked, 'hydro', ELEMENTAL_ECHO_INVITE_MASTERY - 1);
    const at75 = advanceElementalMastery(unlocked, 'hydro', ELEMENTAL_ECHO_INVITE_MASTERY);
    const full = advanceElementalMastery(unlocked, 'hydro', 100);

    expect(canInviteElementalEcho(at74.元素共鸣[0])).toBe(false);
    expect(canInviteElementalEcho(at75.元素共鸣[0])).toBe(true);
    expect(canInviteElementalEcho(full.元素共鸣[0])).toBe(false);

    const entered = enterElementalEcho({ ...createEmptyTeyvatWorld(), 元素回响邀请: 'hydro' });
    const completed = applyElementalEchoResult(at75, entered, 'hydro', ELEMENTAL_ECHO_MASTERY_GAIN);
    expect(completed.traveler.元素共鸣[0].mastery).toBe(100);
    expect(at75.元素共鸣[0].mastery).toBe(ELEMENTAL_ECHO_INVITE_MASTERY);
  });

  it('rejects hidden HSR path values in the elemental echo lifecycle', () => {
    const traveler = unlockElement(createEmptyTravelerProfile(), 'anemo', {
      source: 'traveler_resonance',
      unlockedAt: '1日 08:00',
    });
    const hiddenPathWorld = {
      ...createEmptyTeyvatWorld(),
      元素回响邀请: 'harmony',
    } as unknown as ReturnType<typeof createEmptyTeyvatWorld>;

    expect(() => enterElementalEcho(hiddenPathWorld)).toThrowError('INVALID_ELEMENT_ID');
    expect(() => applyElementalEchoResult(
      traveler,
      { ...createEmptyTeyvatWorld(), 进行中元素回响: 'anemo' },
      'nihility' as never,
      10,
    )).toThrowError('INVALID_ELEMENT_ID');
  });
});

describe('teyvat opening presets', () => {
  it('contains six neutral regional presets without path choices', () => {
    expect(OFFICIAL_OPENING_PRESETS.map((preset) => preset.id)).toEqual([
      'official_mondstadt_dragon',
      'official_liyue_ritual',
      'official_inazuma_decree',
      'official_sumeru_dream',
      'official_fontaine_prophecy',
      'official_natlan_war',
    ]);
    expect(JSON.stringify(OFFICIAL_OPENING_PRESETS)).not.toMatch(/harmony|nihility|preservation|destruction|命途/);
  });

  it('creates a normalized game by applying only region location and identity seed', () => {
    const game = createTeyvatGameFromOpeningPreset('official_liyue_ritual');

    expect(game).toMatchObject({
      universe: 'teyvat',
      schemaVersion: 2,
      旅行者: { 身份: '异乡旅人' },
      世界: { 当前地区: 'liyue', 当前地点: '璃月港 · 玉京台' },
    });
    expect(game.旅行者.姓名).toBe('');
    expect(game.旅行者.主元素).toBe('');
    expect(game.旅行者.元素共鸣).toEqual([]);
    expect(JSON.stringify(game)).not.toMatch(/主命途|命途列表|待触发狭间|进行中狭间/);
  });

  it('rejects an unknown opening preset id', () => {
    expect(() => createTeyvatGameFromOpeningPreset('official_herta_station')).toThrowError('UNKNOWN_OPENING_PRESET');
  });

  it('builds a non-Mondstadt wizard payload with preset identity and formal region', () => {
    const seeded = buildNewGameOpeningPayload({
      presetId: 'official_inazuma_decree',
      name: '测试旅人',
      identity: '',
      element: 'electro',
      canonicalTraveler: '空荧双主角',
      talents: [],
    });
    const explicit = buildNewGameOpeningPayload({
      presetId: 'official_inazuma_decree',
      name: '测试旅人',
      identity: '鸣神岛商人',
      element: 'electro',
      canonicalTraveler: '荧',
      talents: [],
    });
    const formal = applyLegacyWorldState(createEmptyTeyvatGameState(), seeded.world);

    expect(seeded.traveler.身份).toBe('渡海旅人');
    expect(seeded.world).toMatchObject({ 当前地区: 'inazuma', 当前地点: '稻妻 · 离岛码头' });
    expect(formal.世界).toMatchObject({ 当前地区: 'inazuma', 当前地点: '稻妻 · 离岛码头' });
    expect(explicit.traveler.身份).toBe('鸣神岛商人');
  });
});

describe('element validation boundaries', () => {
  it('drops invalid structured-response element ids in runtime and legacy migration', () => {
    const runtime = normalizeConversationLog({ entries: [{
      id: 'runtime', role: 'assistant', content: '', timestamp: 1,
      structuredResponse: { awakenElementId: 'harmony' },
    }] });
    const migrated = migratePartialTeyvatSave({
      universe: 'partial-teyvat',
      旅人: { 主命途: 'hunt' },
      世界: { 待触发狭间: 'harmony', 进行中狭间: 'nihility' },
      chatHistory: [{ id: 'legacy', role: 'assistant', parsedResponse: { awakenPathId: 'nihility' } }],
    }, {});

    expect(runtime.entries[0].structuredResponse).toBeUndefined();
    expect(migrated.status).toBe('migrated');
    if (migrated.status === 'migrated') {
      expect(migrated.state.世界).toMatchObject({ 元素回响邀请: '', 进行中元素回响: '' });
      expect(migrated.state.对话.entries[0].structuredResponse).toBeUndefined();
    }
  });

  it('preserves formal NPC element source and normalized talents through a legacy setter roundtrip', () => {
    const game = createEmptyTeyvatGameState();
    game.NPC = [{
      id: 'npc-amber', 姓名: '安柏', 地区: 'mondstadt', 身份: '侦察骑士', 元素: 'pyro', 力量来源: 'vision',
      天赋: [{ id: 'aimed', 名称: '神射手', 类别: 'passive', 关联元素: 'pyro', 等级: 1, 说明: '精准射击', hidden: true }],
      说明: '', aliases: [], roleTier: 'companion', affinity: 10, relationship: '', intimate: false,
      travelingTogether: false, firstSeenTurn: 1, lastSeenTurn: 1, gender: '女', playerAddress: '', appearance: '',
      clothing: '', speechStyle: '', personality: '', equipmentSummary: '', sharedMemories: [],
      relationshipLedger: { recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [], unfinishedBusiness: [], unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [] },
      notes: [], playerCorrections: [], canonical: true, avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
    } as never];

    const legacy = mapTeyvatNpcsToLegacy(game);
    legacy[0] = { ...legacy[0], 好感度: 20 };
    const roundTripped = applyLegacyNpcRecords(game, legacy);

    expect(roundTripped.NPC[0]).toMatchObject({ 元素: 'pyro', 力量来源: 'vision', affinity: 20 });
    expect(roundTripped.NPC[0].天赋[0]).toEqual({ id: 'aimed', 名称: '神射手', 类别: 'passive', 关联元素: 'pyro', 等级: 1, 说明: '精准射击' });
  });
});
