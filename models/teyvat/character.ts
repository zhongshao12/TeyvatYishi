import { ELEMENT_IDS, type ElementalAttunement, type ElementId, type PowerSource } from './elements';
import { isReservedNpcIdentityName, type NPC外貌档案 } from '../npc';
import { matchCanonicalIdentity } from '@/data/canonicalCharacters';
import { canRevealNpcMeasurements, normalizeNpcAppearanceFacts } from '@/services/npcAppearanceFacts';

export type TalentCategory = 'normal_attack' | 'elemental_skill' | 'elemental_burst' | 'passive';

export interface Talent {
  id: string;
  名称: string;
  类别: TalentCategory;
  关联元素: ElementId | '';
  等级: number;
  说明: string;
}

export interface TravelerProfile {
  id: string;
  姓名: string;
  别名: string;
  性别: string;
  年龄: number;
  生日: string;
  身高: string;
  身份: string;
  外貌: string;
  性格: string;
  背景: string;
  专长知识: string[];
  头像: string;
  元素共鸣: ElementalAttunement[];
  主元素: ElementId | '';
  天赋: Talent[];
  /** Runtime attributes whose keys are domain-defined labels (for example stamina or insight). */
  attributes: Record<string, number>;
  /** Free-form learned capabilities that are not elemental talents. */
  capabilities: string[];
  visualArchive: {
    profileImage?: string;
    narrativeImage?: string;
    courierImage?: string;
    fullPortrait?: string;
  };
}

export interface CanonicalTravelerProfile {
  id: 'aether' | 'lumine';
  名称: '空' | '荧';
  元素共鸣: ElementalAttunement[];
  主元素: ElementId | '';
  天赋: Talent[];
}

export interface TeyvatNpcRecord {
  id: string;
  姓名: string;
  地区: string;
  身份: string;
  元素?: ElementId;
  力量来源?: PowerSource;
  天赋: Talent[];
  说明: string;
  aliases: string[];
  roleTier: 'companion' | 'extra';
  archived?: boolean;
  tierBeforeArchive?: 'companion' | 'extra';
  affinity: number;
  relationship: string;
  intimate: boolean;
  travelingTogether: boolean;
  firstSeenTurn: number;
  lastSeenTurn: number;
  gender: string;
  playerAddress: string;
  appearance: string;
  appearanceFacts?: NPC外貌档案;
  clothing: string;
  speechStyle: string;
  personality: string;
  equipmentSummary: string;
  sharedMemories: TeyvatNpcSharedMemory[];
  relationshipLedger: {
    recentInteraction: string;
    longTermImpression: string;
    currentStage: string;
    sharedExperiences: string[];
    unfinishedBusiness: string[];
    unresolvedConflicts: string[];
    mustRemember: string[];
    protectedFacts: string[];
    summaries: TeyvatNpcSummaryMemory[];
  };
  notes: string[];
  playerCorrections: string[];
  canonical: boolean;
  avatar: string;
  visualArchive: TeyvatNpcVisualArchive;
  matureArchive: TeyvatNpcMatureArchive | null;
}

export interface TeyvatNpcSharedMemory {
  id: string;
  turn: number;
  summary: string;
  sourceText?: string;
  source?: 'narrative' | 'courier' | 'steambird' | 'variable' | 'other';
  relatedNpcIds: string[];
}

export interface TeyvatNpcSummaryMemory {
  id: string;
  turnRange?: string;
  itemCount?: number;
  summary: string;
  retainedFacts: string[];
  relationshipChanges: string[];
  unfinishedBusiness: string[];
}

export interface TeyvatNpcVisualArchive {
  profileImage?: string;
  fullPortrait?: string;
  slotImages: { profile?: string; narrative?: string; courier?: string };
  profilePrompt?: string;
  portraitPrompt?: string;
  status?: 'none' | 'pending' | 'done' | 'failed';
  source?: 'manual' | 'canon' | 'generated' | 'placeholder';
}

export interface TeyvatNpcMatureArchive {
  enabled?: boolean;
  ageConfirmation?: 'adult' | 'unknown' | 'minor_blocked';
  ageConfirmationSource?: 'canonical' | 'manual' | 'legacy_unverified';
  /** Confirmed-adult female only; never inferred by appearance AI. */
  usualUnderwear?: string;
  /** Adult-confirmed female characters only. */
  virginityStatus?: 'virgin' | 'not_virgin' | 'unknown';
  firstSexualPartner?: string;
  firstSexualPartnerRef?: 'player';
  firstSexualPartnerSource?: 'narrative' | 'legacy_assumed' | 'manual';
  firstSexualPartnerTurn?: number;
  intimacyStage?: string;
  boundaries?: string;
  preferences: string[];
  sensitivePoints: string[];
  taboos: string[];
  femaleBodyProfile: { chest?: string; genital?: string; rear?: string; build?: string; scent?: string };
  maleBodyProfile: { genital?: string; rear?: string; build?: string; scent?: string };
  experiences: string[];
  longTermFacts: string[];
  tags: string[];
  partImages: { femaleChest?: string; femaleGenital?: string; maleGenital?: string; rear?: string; bodyReference?: string };
  notes?: string;
}

export function createEmptyTravelerProfile(): TravelerProfile {
  return {
    id: '',
    姓名: '',
    别名: '',
    性别: '',
    年龄: 25,
    生日: '',
    身高: '',
    身份: '',
    外貌: '',
    性格: '',
    背景: '',
    专长知识: [],
    头像: '',
    元素共鸣: [],
    主元素: '',
    天赋: [],
    attributes: {},
    capabilities: [],
    visualArchive: {},
  };
}

const text = (value: unknown): string => typeof value === 'string' ? value : '';
const optionalText = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;
const textList = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const finiteNumber = (value: unknown, fallback = 0): number => Number.isFinite(Number(value)) ? Number(value) : fallback;

function normalizeTalent(value: unknown): Talent | null {
  if (!isRecord(value)) return null;
  const category: TalentCategory = value.类别 === 'elemental_skill' || value.类别 === 'elemental_burst' || value.类别 === 'passive'
    ? value.类别
    : 'normal_attack';
  return {
    id: text(value.id),
    名称: text(value.名称),
    类别: category,
    关联元素: normalizeElementId(value.关联元素) ?? '',
    等级: Math.max(0, Math.trunc(finiteNumber(value.等级))),
    说明: text(value.说明),
  };
}

const normalizeElementId = (value: unknown): ElementId | undefined => (
  typeof value === 'string' && ELEMENT_IDS.includes(value as ElementId) ? value as ElementId : undefined
);
const POWER_SOURCES: readonly PowerSource[] = ['vision', 'traveler_resonance', 'adeptal', 'divine', 'abyssal', 'other'];
const normalizePowerSource = (value: unknown): PowerSource | undefined => (
  typeof value === 'string' && POWER_SOURCES.includes(value as PowerSource) ? value as PowerSource : undefined
);

export function normalizeTravelerProfile(value: unknown): TravelerProfile {
  const raw = isRecord(value) ? value : {};
  const base = createEmptyTravelerProfile();
  return {
    id: text(raw.id), 姓名: text(raw.姓名), 别名: text(raw.别名), 性别: text(raw.性别), 年龄: Math.max(0, Math.trunc(finiteNumber(raw.年龄, base.年龄))),
    生日: text(raw.生日), 身高: text(raw.身高), 身份: text(raw.身份), 外貌: text(raw.外貌), 性格: text(raw.性格), 背景: text(raw.背景),
    专长知识: textList(raw.专长知识), 头像: text(raw.头像),
    元素共鸣: Array.isArray(raw.元素共鸣) ? raw.元素共鸣.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const element = normalizeElementId(entry.element);
      if (!element) return [];
      return [{ element, source: normalizePowerSource(entry.source) ?? 'traveler_resonance', mastery: finiteNumber(entry.mastery), unlocked: entry.unlocked !== false, unlockedAt: text(entry.unlockedAt), notes: text(entry.notes) }];
    }) : [],
    主元素: normalizeElementId(raw.主元素) ?? '',
    天赋: Array.isArray(raw.天赋) ? raw.天赋.flatMap((entry) => normalizeTalent(entry) ?? []) : [],
    attributes: isRecord(raw.attributes) ? Object.fromEntries(Object.entries(raw.attributes).flatMap(([key, item]) => Number.isFinite(Number(item)) ? [[key, Number(item)]] : [])) : {},
    capabilities: textList(raw.capabilities),
    visualArchive: isRecord(raw.visualArchive) ? { profileImage: optionalText(raw.visualArchive.profileImage), narrativeImage: optionalText(raw.visualArchive.narrativeImage), courierImage: optionalText(raw.visualArchive.courierImage), fullPortrait: optionalText(raw.visualArchive.fullPortrait) } : {},
  };
}

export function normalizeTeyvatNpcSharedMemory(value: unknown): TeyvatNpcSharedMemory | null {
  if (!isRecord(value)) return null;
  const sourceValue = value.source === 'news' ? 'steambird' : text(value.source);
  const source = ['narrative', 'courier', 'steambird', 'variable', 'other'].includes(sourceValue)
    ? sourceValue as TeyvatNpcSharedMemory['source']
    : undefined;
  return {
    id: text(value.id), turn: Math.max(0, Math.trunc(finiteNumber(value.turn))), summary: text(value.summary),
    ...(optionalText(value.sourceText) ? { sourceText: text(value.sourceText) } : {}),
    ...(source ? { source } : {}), relatedNpcIds: textList(value.relatedNpcIds),
  };
}

export function normalizeTeyvatNpcSummaryMemory(value: unknown): TeyvatNpcSummaryMemory | null {
  if (!isRecord(value)) return null;
  return {
    id: text(value.id), ...(optionalText(value.turnRange) ? { turnRange: text(value.turnRange) } : {}),
    ...(Number.isFinite(Number(value.itemCount)) ? { itemCount: Math.max(0, Math.trunc(Number(value.itemCount))) } : {}),
    summary: text(value.summary), retainedFacts: textList(value.retainedFacts),
    relationshipChanges: textList(value.relationshipChanges), unfinishedBusiness: textList(value.unfinishedBusiness),
  };
}

export function normalizeTeyvatNpcVisualArchive(value: unknown): TeyvatNpcVisualArchive {
  const raw = isRecord(value) ? value : {};
  const slots = isRecord(raw.slotImages) ? raw.slotImages : {};
  const status = ['none', 'pending', 'done', 'failed'].includes(text(raw.status)) ? text(raw.status) as TeyvatNpcVisualArchive['status'] : undefined;
  const source = ['manual', 'canon', 'generated', 'placeholder'].includes(text(raw.source)) ? text(raw.source) as TeyvatNpcVisualArchive['source'] : undefined;
  return {
    ...(optionalText(raw.profileImage) ? { profileImage: text(raw.profileImage) } : {}),
    ...(optionalText(raw.fullPortrait) ? { fullPortrait: text(raw.fullPortrait) } : {}),
    slotImages: {
      ...(optionalText(slots.profile) ? { profile: text(slots.profile) } : {}),
      ...(optionalText(slots.narrative) ? { narrative: text(slots.narrative) } : {}),
      ...(optionalText(slots.courier) ? { courier: text(slots.courier) } : {}),
    },
    ...(optionalText(raw.profilePrompt) ? { profilePrompt: text(raw.profilePrompt) } : {}),
    ...(optionalText(raw.portraitPrompt) ? { portraitPrompt: text(raw.portraitPrompt) } : {}),
    ...(status ? { status } : {}), ...(source ? { source } : {}),
  };
}

export function normalizeTeyvatNpcMatureArchive(value: unknown): TeyvatNpcMatureArchive | null {
  if (!isRecord(value)) return null;
  const female = isRecord(value.femaleBodyProfile) ? value.femaleBodyProfile : {};
  const male = isRecord(value.maleBodyProfile) ? value.maleBodyProfile : {};
  const images = isRecord(value.partImages) ? value.partImages : {};
  const age = ['adult', 'unknown', 'minor_blocked'].includes(text(value.ageConfirmation))
    ? text(value.ageConfirmation) as TeyvatNpcMatureArchive['ageConfirmation']
    : undefined;
  const ageSource = ['canonical', 'manual'].includes(text(value.ageConfirmationSource))
    ? text(value.ageConfirmationSource) as TeyvatNpcMatureArchive['ageConfirmationSource']
    : age ? 'legacy_unverified' : undefined;
  const virginityStatus = age === 'adult' && ['virgin', 'not_virgin', 'unknown'].includes(text(value.virginityStatus))
    ? text(value.virginityStatus) as NonNullable<TeyvatNpcMatureArchive['virginityStatus']>
    : undefined;
  return {
    ...(typeof value.enabled === 'boolean' ? { enabled: value.enabled } : {}), ...(age ? { ageConfirmation: age } : {}),
    ...(ageSource ? { ageConfirmationSource: ageSource } : {}),
    ...(age === 'adult' && optionalText(value.usualUnderwear) ? { usualUnderwear: text(value.usualUnderwear).slice(0, 120) } : {}),
    ...(virginityStatus ? { virginityStatus } : {}),
    ...(age === 'adult' && optionalText(value.firstSexualPartner) ? { firstSexualPartner: text(value.firstSexualPartner) } : {}),
    ...(age === 'adult' && value.firstSexualPartnerRef === 'player' ? { firstSexualPartnerRef: 'player' as const } : {}),
    ...(age === 'adult' && ['narrative', 'legacy_assumed', 'manual'].includes(text(value.firstSexualPartnerSource))
      ? { firstSexualPartnerSource: text(value.firstSexualPartnerSource) as TeyvatNpcMatureArchive['firstSexualPartnerSource'] } : {}),
    ...(age === 'adult' && Number.isInteger(value.firstSexualPartnerTurn) && Number(value.firstSexualPartnerTurn) > 0
      ? { firstSexualPartnerTurn: Number(value.firstSexualPartnerTurn) } : {}),
    ...(optionalText(value.intimacyStage) ? { intimacyStage: text(value.intimacyStage) } : {}),
    ...(optionalText(value.boundaries) ? { boundaries: text(value.boundaries) } : {}),
    preferences: textList(value.preferences), sensitivePoints: textList(value.sensitivePoints), taboos: textList(value.taboos),
    femaleBodyProfile: { chest: optionalText(female.chest), genital: optionalText(female.genital), rear: optionalText(female.rear), build: optionalText(female.build), scent: optionalText(female.scent) },
    maleBodyProfile: { genital: optionalText(male.genital), rear: optionalText(male.rear), build: optionalText(male.build), scent: optionalText(male.scent) },
    experiences: textList(value.experiences), longTermFacts: textList(value.longTermFacts), tags: textList(value.tags),
    partImages: { femaleChest: optionalText(images.femaleChest), femaleGenital: optionalText(images.femaleGenital), maleGenital: optionalText(images.maleGenital), rear: optionalText(images.rear), bodyReference: optionalText(images.bodyReference) },
    ...(optionalText(value.notes) ? { notes: text(value.notes) } : {}),
  };
}

export function normalizeTeyvatNpcRecords(value: unknown): TeyvatNpcRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    if (isReservedNpcIdentityName(entry.姓名)) return [];
    const ledger = isRecord(entry.relationshipLedger) ? entry.relationshipLedger : {};
    const rawId = text(entry.id);
    const rawName = text(entry.姓名);
    const rawAliases = textList(entry.aliases);
    const canonical = matchCanonicalIdentity({ id: rawId, name: rawName, aliases: rawAliases });
    const matureArchive = normalizeTeyvatNpcMatureArchive(entry.matureArchive);
    const eligibleForMeasurements = canRevealNpcMeasurements({
      name: canonical?.name ?? rawName, aliases: rawAliases, gender: text(entry.gender) || canonical?.gender,
      description: [text(entry.说明), text(entry.appearance), ...textList(entry.notes)].filter(Boolean).join(' '),
      ageConfirmation: matureArchive?.ageConfirmation, ageSource: matureArchive?.ageConfirmationSource,
    });
    const appearanceFacts = normalizeNpcAppearanceFacts(entry.appearanceFacts, eligibleForMeasurements);
    const archived = entry.archived === true;
    const roleTier = archived ? 'extra' : canonical || entry.roleTier === 'companion' ? 'companion' : 'extra';
    const tierBeforeArchive = entry.tierBeforeArchive === 'companion' || entry.tierBeforeArchive === 'extra'
      ? entry.tierBeforeArchive : canonical || entry.roleTier === 'companion' ? 'companion' : 'extra';
    return [{
      id: rawId, 姓名: canonical?.name ?? rawName, 地区: text(entry.地区), 身份: text(entry.身份),
      ...(normalizeElementId(entry.元素) ? { 元素: normalizeElementId(entry.元素) } : {}),
      ...(normalizePowerSource(entry.力量来源) ? { 力量来源: normalizePowerSource(entry.力量来源) } : {}),
      天赋: Array.isArray(entry.天赋) ? entry.天赋.flatMap((talent) => normalizeTalent(talent) ?? []) : [],
      说明: text(entry.说明), aliases: canonical?.aliases ? Array.from(new Set([...canonical.aliases, ...rawAliases])) : rawAliases, roleTier,
      ...(archived ? { archived: true, tierBeforeArchive } : {}), affinity: finiteNumber(entry.affinity),
      relationship: text(entry.relationship), intimate: entry.intimate === true, travelingTogether: !archived && entry.travelingTogether === true,
      firstSeenTurn: Math.max(0, Math.trunc(finiteNumber(entry.firstSeenTurn))), lastSeenTurn: Math.max(0, Math.trunc(finiteNumber(entry.lastSeenTurn))),
      gender: text(entry.gender) || canonical?.gender || '', playerAddress: text(entry.playerAddress), appearance: text(entry.appearance) || canonical?.appearance || '',
      ...(appearanceFacts ? { appearanceFacts } : {}), clothing: text(entry.clothing),
      speechStyle: text(entry.speechStyle), personality: canonical?.personality || text(entry.personality), equipmentSummary: text(entry.equipmentSummary),
      sharedMemories: Array.isArray(entry.sharedMemories) ? entry.sharedMemories.flatMap((item) => normalizeTeyvatNpcSharedMemory(item) ?? []) : [],
      relationshipLedger: {
        recentInteraction: text(ledger.recentInteraction), longTermImpression: text(ledger.longTermImpression), currentStage: text(ledger.currentStage),
        sharedExperiences: textList(ledger.sharedExperiences), unfinishedBusiness: textList(ledger.unfinishedBusiness),
        unresolvedConflicts: textList(ledger.unresolvedConflicts), mustRemember: textList(ledger.mustRemember), protectedFacts: textList(ledger.protectedFacts),
        summaries: Array.isArray(ledger.summaries) ? ledger.summaries.flatMap((item) => normalizeTeyvatNpcSummaryMemory(item) ?? []) : [],
      },
      notes: textList(entry.notes), playerCorrections: textList(entry.playerCorrections), canonical: entry.canonical === true || Boolean(canonical),
      avatar: text(entry.avatar), visualArchive: normalizeTeyvatNpcVisualArchive(entry.visualArchive),
      matureArchive: matureArchive && !eligibleForMeasurements ? { ...matureArchive, usualUnderwear: undefined } : matureArchive,
    }];
  });
}
import { isRecord } from '@/utils/valueGuards';
