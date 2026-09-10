import type { TravelerProfile } from '@/models/teyvat/character';
import {
  ELEMENT_IDS,
  type ElementalAttunement,
  type ElementId,
  type PowerSource,
} from '@/models/teyvat/elements';
import { buildCanonicalElementTalents } from '@/data/canonicalTravelerPresets';

export const ELEMENTAL_ECHO_INVITE_MASTERY = 75;
export const ELEMENTAL_ECHO_MASTERY_GAIN = 25;

export interface UnlockElementOptions {
  source: PowerSource;
  unlockedAt: string;
  notes?: string;
}

export interface ElementalEchoState {
  元素回响邀请: string;
  进行中元素回响: string;
}

export interface ElementalTravelerState {
  id?: string;
  元素共鸣: TravelerProfile['元素共鸣'];
  主元素: TravelerProfile['主元素'];
  天赋?: TravelerProfile['天赋'];
}

function assertElementId(value: string): asserts value is ElementId {
  if (!ELEMENT_IDS.includes(value as ElementId)) throw new Error('INVALID_ELEMENT_ID');
}

export function unlockElement<T extends ElementalTravelerState>(
  traveler: T,
  element: ElementId,
  options: UnlockElementOptions,
): T {
  assertElementId(element);
  const existingIndex = traveler.元素共鸣.findIndex((entry) => entry.element === element);
  const nextAttunement = {
    element,
    source: options.source,
    mastery: existingIndex >= 0 ? traveler.元素共鸣[existingIndex].mastery : 0,
    unlocked: true,
    unlockedAt: options.unlockedAt,
    notes: options.notes ?? '',
  };
  const 元素共鸣 = existingIndex >= 0
    ? traveler.元素共鸣.map((entry, index) => index === existingIndex ? nextAttunement : entry)
    : [...traveler.元素共鸣, nextAttunement];
  const isCanonicalTraveler = traveler.id === 'traveler_canonical_aether' || traveler.id === 'traveler_canonical_lumine';
  const elementalTalents = isCanonicalTraveler ? buildCanonicalElementTalents(element) : [];
  const 天赋 = traveler.天赋 && elementalTalents.length
    ? [...traveler.天赋, ...elementalTalents.filter((talent) => !traveler.天赋?.some((entry) => entry.id === talent.id))]
    : traveler.天赋;
  return { ...traveler, 元素共鸣, ...(天赋 ? { 天赋 } : {}) };
}

export function advanceElementalMastery<T extends ElementalTravelerState>(
  traveler: T,
  element: ElementId,
  delta: number,
): T {
  assertElementId(element);
  if (!Number.isFinite(delta)) throw new Error('INVALID_MASTERY_DELTA');
  const index = traveler.元素共鸣.findIndex((entry) => entry.element === element && entry.unlocked);
  if (index < 0) throw new Error('ELEMENT_NOT_UNLOCKED');
  const mastery = Math.max(0, Math.min(100, traveler.元素共鸣[index].mastery + delta));
  return {
    ...traveler,
    元素共鸣: traveler.元素共鸣.map((entry, entryIndex) => (
      entryIndex === index ? { ...entry, mastery } : entry
    )),
  };
}

/**
 * 技能熟练度结算：对本回合旅行者实际使用的元素逐个增长熟练度。
 * 未解锁 / 已满级 / 非法元素静默跳过，不阻塞回合结算。
 */
export function applyTravelerSkillMastery<T extends ElementalTravelerState>(
  traveler: T,
  elements: readonly ElementId[],
  gainPerTurn: number,
): { traveler: T; gains: ElementId[] } {
  let next = traveler;
  const gains: ElementId[] = [];
  for (const element of new Set(elements)) {
    if (!next.元素共鸣.some((entry) => entry.unlocked && entry.element === element)) continue;
    try {
      next = advanceElementalMastery(next, element, gainPerTurn);
      gains.push(element);
    } catch {
      // 元素未解锁或参数非法时不阻塞回合结算。
    }
  }
  return { traveler: next, gains };
}

export function canInviteElementalEcho(attunement: ElementalAttunement): boolean {
  return attunement.unlocked
    && Number.isFinite(attunement.mastery)
    && attunement.mastery >= ELEMENTAL_ECHO_INVITE_MASTERY
    && attunement.mastery < 100;
}

export function setPrimaryElement<T extends ElementalTravelerState>(traveler: T, element: ElementId): T {
  assertElementId(element);
  if (!traveler.元素共鸣.some((entry) => entry.element === element && entry.unlocked)) {
    throw new Error('ELEMENT_NOT_UNLOCKED');
  }
  return { ...traveler, 主元素: element };
}

export function enterElementalEcho<T extends ElementalEchoState>(world: T): T {
  if (!world.元素回响邀请 || world.进行中元素回响) return world;
  assertElementId(world.元素回响邀请);
  return {
    ...world,
    元素回响邀请: '',
    进行中元素回响: world.元素回响邀请,
  };
}

export function applyElementalEchoResult<TTraveler extends ElementalTravelerState, TWorld extends ElementalEchoState>(
  traveler: TTraveler,
  world: TWorld,
  element: ElementId,
  masteryGain: number,
): { traveler: TTraveler; world: TWorld } {
  assertElementId(element);
  if (world.进行中元素回响 !== element) throw new Error('ELEMENTAL_ECHO_NOT_ACTIVE');
  return {
    traveler: advanceElementalMastery(traveler, element, masteryGain),
    world: { ...world, 进行中元素回响: '' },
  };
}
