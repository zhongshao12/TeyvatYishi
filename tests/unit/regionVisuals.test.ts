import { describe, expect, it } from 'vitest';
import { getRegionVisual, REGION_VISUALS } from '@/data/regionVisuals';

const EXPECTED_REGIONS = ['mondstadt', 'liyue', 'inazuma', 'sumeru', 'fontaine', 'natlan', 'nod_krai'];

describe('region visual registry', () => {
  it('registers all seven journal regions', () => {
    expect(Object.keys(REGION_VISUALS)).toEqual(EXPECTED_REGIONS);
  });

  it.each(EXPECTED_REGIONS)('uses the planned WebP background and a readable overlay for %s', (region) => {
    const visual = REGION_VISUALS[region as keyof typeof REGION_VISUALS];

    expect(visual.background).toBe(
      region === 'nod_krai'
        ? '/assets/backgrounds/snezhnaya.webp'
        : `/assets/regions/${region}-journal.webp`,
    );
    expect(visual.overlayOpacity).toBeGreaterThanOrEqual(0.35);
    expect(visual.overlayOpacity).toBeLessThanOrEqual(0.8);
  });

  it('resolves the Snezhnaya journal visual and keeps an unknown-region fallback', () => {
    expect(getRegionVisual('nod_krai')).toBe(REGION_VISUALS.nod_krai);
    expect(getRegionVisual('unknown')).toBe(REGION_VISUALS.mondstadt);
  });
});
