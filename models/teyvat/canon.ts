export type CanonDeviationStatus = 'active' | 'resolved' | 'archived';
export type CanonReturnability = 'none' | 'conditional' | 'open';

export const TEYVAT_CANON_ANCHOR_IDS = [
  'teyvat_prologue_mondstadt_act1',
  'teyvat_prologue_mondstadt_act2',
  'teyvat_prologue_mondstadt_act3',
  'teyvat_chapter_liyue_act1',
  'teyvat_chapter_liyue_interlude',
  'teyvat_chapter_inazuma_act2',
  'teyvat_chapter_inazuma_storm',
  'teyvat_chapter_inazuma_aftermath',
  'teyvat_chapter_sumeru_act3',
  'teyvat_chapter_sumeru_dream',
  'teyvat_chapter_sumeru_worldtree',
  'teyvat_chapter_sumeru_farewell',
  'teyvat_chapter_sumeru_depart',
  'teyvat_side_mondstadt_fourwinds',
  'teyvat_side_liyue_lantern',
  'teyvat_side_inazuma_sakura',
] as const;

export type TeyvatCanonAnchorId = typeof TEYVAT_CANON_ANCHOR_IDS[number];

export const TEYVAT_CANON_SERIES_ANCHORS: Readonly<Record<string, TeyvatCanonAnchorId>> = {
  story_canon_teyvat_mondstadt_prologue_act1: 'teyvat_prologue_mondstadt_act1',
  story_canon_teyvat_mondstadt_prologue_act2: 'teyvat_prologue_mondstadt_act2',
  story_canon_teyvat_mondstadt_prologue_act3: 'teyvat_prologue_mondstadt_act3',
  story_canon_teyvat_liyue_chapter1: 'teyvat_chapter_liyue_act1',
  story_canon_teyvat_liyue_interlude: 'teyvat_chapter_liyue_interlude',
  story_canon_teyvat_inazuma_chapter2: 'teyvat_chapter_inazuma_act2',
  story_canon_teyvat_inazuma_chapter2_storm: 'teyvat_chapter_inazuma_storm',
  story_canon_teyvat_inazuma_chapter2_aftermath: 'teyvat_chapter_inazuma_aftermath',
  story_canon_teyvat_sumeru_chapter3: 'teyvat_chapter_sumeru_act3',
  story_canon_teyvat_sumeru_chapter3_dream: 'teyvat_chapter_sumeru_dream',
  story_canon_teyvat_sumeru_chapter3_worldtree: 'teyvat_chapter_sumeru_worldtree',
  story_canon_teyvat_sumeru_chapter3_farewell: 'teyvat_chapter_sumeru_farewell',
  story_canon_teyvat_sumeru_chapter3_depart: 'teyvat_chapter_sumeru_depart',
  story_canon_side_mondstadt_fourwinds: 'teyvat_side_mondstadt_fourwinds',
  story_canon_side_liyue_lantern: 'teyvat_side_liyue_lantern',
  story_canon_side_inazuma_sakura: 'teyvat_side_inazuma_sakura',
};

export function getTeyvatCanonAnchorIdForSeries(seriesId: string): TeyvatCanonAnchorId | undefined {
  return TEYVAT_CANON_SERIES_ANCHORS[seriesId];
}

export interface CanonDeviation {
  id: string;
  anchorId: TeyvatCanonAnchorId;
  turn: number;
  evidence: string[];
  status: CanonDeviationStatus;
  affectedCharacters: string[];
  worldEffects: string[];
  blockedAnchorIds: TeyvatCanonAnchorId[];
  returnability: CanonReturnability;
}

export type CanonDeviationInput = Omit<CanonDeviation, 'id'>;

export interface CanonTrack {
  currentAnchor: string;
  deviations: CanonDeviation[];
  notes: string[];
}

export function createEmptyCanonTrack(): CanonTrack {
  return { currentAnchor: '', deviations: [], notes: [] };
}
