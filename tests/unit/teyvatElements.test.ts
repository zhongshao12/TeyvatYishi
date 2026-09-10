import { describe, expect, it } from 'vitest';
import { ELEMENT_IDS, normalizeElementalAttunement } from '@/models/teyvat/elements';

describe('teyvat element domain', () => {
  it('contains exactly the seven canonical elements', () => {
    expect(ELEMENT_IDS).toEqual(['anemo', 'geo', 'electro', 'dendro', 'hydro', 'pyro', 'cryo']);
    expect(ELEMENT_IDS).not.toContain('abyss');
  });

  it('clamps gameplay mastery without inventing a lore rank', () => {
    expect(normalizeElementalAttunement({ element: 'anemo', source: 'traveler_resonance', mastery: 140 })).toMatchObject({ mastery: 100 });
  });
});
