import { createCoreIdentity } from '../contracts/identity';
import type { JourneySeed } from '../contracts/operation';
import type { TravelerState } from '../contracts/state';
import { isCoreJsonData, validateCoreDto } from '../contracts/validation';
import { createEmptyTravelerProfile } from '@/models/teyvat/character';
import { buildCanonicalTravelerPreset, buildCanonicalElementTalents } from '@/data/canonicalTravelerPresets';
import { getOfficialOpeningPreset, type OfficialOpeningPresetId, type 剧情模式 } from '@/models/teyvat/opening';
import { ELEMENT_IDS, type ElementId } from '@/models/teyvat/elements';
import { getDefaultBuiltinAvatar } from '@/data/builtinAvatars';
import { freezeSource } from '../sources/sourceRecords';
import { createCoreNpcProfile } from '../settlement/npcBaseline';
import { stableJson } from '../persistence/repositoryValidation';
import type { WorldMoment } from '@/models/teyvat/worldMoment';

export type CoreOpeningProfile = Partial<Pick<TravelerState, '别名' | '性别' | '年龄' | '生日' | '身高' | '身份' | '外貌' | '性格' | '背景'>>;
export interface CoreOpeningChoice {
  name: string; travelerPreset: 'custom' | '空' | '荧'; openingPresetId: OfficialOpeningPresetId;
  canonicalCompanion?: '' | '空' | '荧'; initialElement?: ElementId; storyMode?: 剧情模式; profile?: CoreOpeningProfile;
}
export const CORE_OPENING_SERIES: Readonly<Record<OfficialOpeningPresetId, string>> = {
  official_mondstadt_dragon: 'story_canon_teyvat_mondstadt_prologue_act1',
  official_liyue_ritual: 'story_canon_teyvat_liyue_chapter1',
  official_inazuma_decree: 'story_canon_teyvat_inazuma_chapter2',
  official_sumeru_dream: 'story_canon_teyvat_sumeru_chapter3',
  official_fontaine_prophecy: 'story_canon_teyvat_fontaine_chapter4',
  official_natlan_war: 'story_canon_teyvat_natlan_chapter5',
};
/** Explicit initialization choices; never adapts a legacy save or writable game root. */
export function createCoreOpeningSeed(input: CoreOpeningChoice): JourneySeed {
  if (!isCoreJsonData(input) || !input || !Object.keys(input).every(key => ['name', 'travelerPreset', 'openingPresetId', 'canonicalCompanion', 'initialElement', 'storyMode', 'profile'].includes(key))
    || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80 || !['custom', '空', '荧'].includes(input.travelerPreset)
    || input.canonicalCompanion !== undefined && !['', '空', '荧'].includes(input.canonicalCompanion)
    || input.initialElement !== undefined && !ELEMENT_IDS.includes(input.initialElement)
    || input.storyMode !== undefined && !['normal', 'harem', 'romance_alt', 'deep_single'].includes(input.storyMode)) throw Error('开局选项无效，请检查姓名与预设。');
  if (input.travelerPreset !== 'custom' && input.canonicalCompanion === input.travelerPreset) throw Error('原著同伴不能与本人重复。');
  if (input.profile && (!Object.keys(input.profile).every(key => ['别名', '性别', '年龄', '生日', '身高', '身份', '外貌', '性格', '背景'].includes(key))
    || Object.entries(input.profile).some(([key, value]) => key === '年龄' ? !Number.isSafeInteger(value) || Number(value) < 0 : typeof value !== 'string' || value.length > 20000))) throw Error('旅人档案字段无效。');
  const presetId = input.travelerPreset === 'custom' ? input.openingPresetId : 'official_mondstadt_dragon', preset = getOfficialOpeningPreset(presetId);
  if (!preset) throw Error('开局资源不存在。');
  const identity = createCoreIdentity(), scope = identity.scope, canon = input.travelerPreset === 'custom' ? null : buildCanonicalTravelerPreset(input.travelerPreset);
  const element = canon?.primaryElement ?? input.initialElement;
  const moment: WorldMoment = { worldName: '提瓦特', date: '旅行历 1000.03.07', clock: '10:00', weather: '晴', location: preset.location, locationId: 'opening-' + preset.regionId, travelDay: 1, turn: 0, settlementId: 'initialization' };
  const player: TravelerState = { ...createEmptyTravelerProfile(), id: identity.playerId, 姓名: input.name.trim(), 身份: preset.identitySeed.身份,
    ...(canon ? { 性别: canon.gender, 外貌: canon.appearance, 性格: canon.personality, 背景: canon.background, 头像: getDefaultBuiltinAvatar(canon.name) ?? '' } : {}),
    ...structuredClone(input.profile ?? {}), 元素共鸣: canon ? structuredClone(canon.元素共鸣) : element ? [{ element, source: 'vision', mastery: 0, unlocked: true, unlockedAt: '开局档案', notes: '' }] : [],
    主元素: element ?? '', 天赋: element ? buildCanonicalElementTalents(element) : [], visualArchive: { slotImages: {} }, level: 1, health: 100, experience: 0 };
  const opening = { presetId, travelerPreset: input.travelerPreset, canonicalCompanion: input.canonicalCompanion ?? '', storyMode: input.storyMode ?? 'normal' };
  const source = freezeSource({ scope, operationId: 'initialization', kind: 'initialization', moment, blocks: [{ blockId: 'opening', kind: 'configuration', text: stableJson({ choice: input, effectivePreset: preset, opening }) }] });
  const seed: JourneySeed = { head: { scope, sessionId: identity.sessionId, coreSeq: 0, memoryRevision: 0 }, playerId: identity.playerId, sources: [source], contentRefs: [], records: [
    { scope, domain: 'traveler', entityId: identity.playerId, version: 1, value: player },
    { scope, domain: 'world', entityId: 'world', version: 1, value: { moment, region: preset.regionId, visitedRegions: [preset.regionId], atmosphere: preset.summary, completedMainTurns: 0, proactiveLastTurn: 0, opening } },
    { scope, domain: 'inventory', entityId: 'wallet', version: 1, value: { kind: 'wallet', mora: 0 } },
    { scope, domain: 'story', entityId: 'story', version: 1, value: { seriesId: CORE_OPENING_SERIES[preset.id], chapterId: null, nodeId: null, completedNodeIds: [], status: 'not_started' } },
    { scope, domain: 'map', entityId: moment.locationId!, version: 1, value: { locationId: moment.locationId!, name: preset.location, region: preset.regionId, visited: true } },
    { scope, domain: 'doudizhu', entityId: 'doudizhu', version: 1, value: { currentGame: null } },
  ] };
  if (input.canonicalCompanion) {
    const name = input.canonicalCompanion, npcId = name === '空' ? 'npc-canon-aether' : 'npc-canon-lumine', companion = createCoreNpcProfile({ npcId, name, playerName: player.姓名, turn: 0 });
    companion.travelingTogether = true; companion.身份 = '旅行者'; companion.地区 = preset.location;
    seed.records.push({ scope, domain: 'npc', entityId: npcId, version: 1, value: companion },
      { scope, domain: 'courier', entityId: 'contact-' + npcId, version: 1, value: { kind: 'contact', npcId, name, remark: '', available: true } });
  }
  if (!validateCoreDto('seed', seed).ok) throw Error('开局资料未通过校验，没有建立旅程。');
  return seed;
}
