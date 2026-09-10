import type { RegionId } from '@/models/teyvat/world';

export type JournalRegionId = RegionId;

export interface RegionVisual {
  readonly background: `/assets/regions/${string}-journal.webp` | `/assets/backgrounds/${string}.webp`;
  readonly overlayOpacity: number;
  readonly overlayColor: string;
  readonly accentColor: string;
  readonly paperTint: string;
}

export const JOURNAL_REGION_IDS = [
  'mondstadt',
  'liyue',
  'inazuma',
  'sumeru',
  'fontaine',
  'natlan',
  'nod_krai',
] as const satisfies readonly JournalRegionId[];

export const REGION_VISUALS = {
  mondstadt: {
    background: '/assets/regions/mondstadt-journal.webp',
    overlayOpacity: 0.48,
    overlayColor: '#172820',
    accentColor: '#6f9b78',
    paperTint: '#efe5c9',
  },
  liyue: {
    background: '/assets/regions/liyue-journal.webp',
    overlayOpacity: 0.5,
    overlayColor: '#34271c',
    accentColor: '#b28145',
    paperTint: '#f0dfba',
  },
  inazuma: {
    background: '/assets/regions/inazuma-journal.webp',
    overlayOpacity: 0.54,
    overlayColor: '#29223a',
    accentColor: '#8b72aa',
    paperTint: '#e8ddcf',
  },
  sumeru: {
    background: '/assets/regions/sumeru-journal.webp',
    overlayOpacity: 0.5,
    overlayColor: '#173026',
    accentColor: '#668754',
    paperTint: '#e9e2bd',
  },
  fontaine: {
    background: '/assets/regions/fontaine-journal.webp',
    overlayOpacity: 0.48,
    overlayColor: '#1b3040',
    accentColor: '#688fa7',
    paperTint: '#e6e3d2',
  },
  natlan: {
    background: '/assets/regions/natlan-journal.webp',
    overlayOpacity: 0.55,
    overlayColor: '#3b2019',
    accentColor: '#a55c3e',
    paperTint: '#ead7b8',
  },
  nod_krai: {
    background: '/assets/backgrounds/snezhnaya.webp',
    overlayOpacity: 0.58,
    overlayColor: '#182635',
    accentColor: '#8aa9bd',
    paperTint: '#e5e7df',
  },
} as const satisfies Record<JournalRegionId, RegionVisual>;

export const DEFAULT_REGION_VISUAL_ID: JournalRegionId = 'mondstadt';

export function getRegionVisual(region: RegionId | string | null | undefined): RegionVisual {
  if (region && Object.prototype.hasOwnProperty.call(REGION_VISUALS, region)) {
    return REGION_VISUALS[region as JournalRegionId];
  }
  return REGION_VISUALS[DEFAULT_REGION_VISUAL_ID];
}
