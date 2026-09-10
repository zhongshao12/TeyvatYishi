export const ELEMENT_IDS = ['anemo', 'geo', 'electro', 'dendro', 'hydro', 'pyro', 'cryo'] as const;

export type ElementId = typeof ELEMENT_IDS[number];

export type PowerSource = 'vision' | 'traveler_resonance' | 'adeptal' | 'divine' | 'abyssal' | 'other';

export interface ElementalAttunement {
  element: ElementId;
  source: PowerSource;
  mastery: number;
  unlocked: boolean;
  unlockedAt: string;
  notes: string;
}

export function normalizeElementalAttunement(input: Partial<ElementalAttunement>): ElementalAttunement {
  if (!ELEMENT_IDS.includes(input.element as ElementId)) throw new Error('INVALID_ELEMENT_ID');

  return {
    element: input.element as ElementId,
    source: input.source ?? 'other',
    mastery: Math.max(0, Math.min(100, Number(input.mastery) || 0)),
    unlocked: input.unlocked !== false,
    unlockedAt: String(input.unlockedAt ?? ''),
    notes: String(input.notes ?? ''),
  };
}
