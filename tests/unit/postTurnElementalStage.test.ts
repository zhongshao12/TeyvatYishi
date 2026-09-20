import { describe, expect, it } from 'vitest';

import { settlePostTurnElements } from '@/hooks/useGame/postTurnElementalStage';
import { createEmptyElementalField } from '@/models/teyvat/elementalGauge';
import { createEmptyTravelerProfile } from '@/models/teyvat/character';
import { unlockElement } from '@/services/elementalAttunementService';

function createTravelerWithPyroAndHydro() {
  const pyroTraveler = unlockElement(createEmptyTravelerProfile(), 'pyro', {
    source: 'traveler_resonance',
    unlockedAt: '1日 08:00',
  });
  return unlockElement(pyroTraveler, 'hydro', {
    source: 'traveler_resonance',
    unlockedAt: '1日 08:00',
  });
}

describe('post-turn elemental stage', () => {
  it('settles multiple elements cumulatively so reactions are not overwritten', () => {
    const result = settlePostTurnElements({
      body: '【荧】先用火元素点燃剑锋，紧接着以水元素斩向敌人。',
      traveler: createTravelerWithPyroAndHydro(),
      travelerNames: ['荧', '旅行者'],
      field: createEmptyElementalField(),
      events: [],
      turn: 8,
    });

    expect(result.field.auraElement).toBe('hydro');
    expect(result.events.map((event) => event.name)).toEqual(['蒸发']);
    expect(result.masteryGains).toEqual(['pyro', 'hydro']);
    expect(result.traveler.元素共鸣.find((entry) => entry.element === 'pyro')?.mastery).toBe(2);
    expect(result.traveler.元素共鸣.find((entry) => entry.element === 'hydro')?.mastery).toBe(2);
  });

  it('updates the field for enemy elements without granting traveler mastery', () => {
    const result = settlePostTurnElements({
      body: '【深渊法师】让冰元素席卷战场。',
      traveler: createTravelerWithPyroAndHydro(),
      travelerNames: ['荧', '旅行者'],
      field: createEmptyElementalField(),
      events: [],
      turn: 9,
    });

    expect(result.field.auraElement).toBe('cryo');
    expect(result.masteryGains).toEqual([]);
    expect(result.fieldChanged).toBe(true);
  });
});
