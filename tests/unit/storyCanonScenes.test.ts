import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateBundledStorySeries } from '@/data/storyCanonValidation';
import { 归一化剧情编织系列 } from '@/models/storyWeaving';

const segmentCounts = {
  story_canon_teyvat_mondstadt_prologue_act1: 4,
  story_canon_teyvat_mondstadt_prologue_act2: 4,
  story_canon_teyvat_mondstadt_prologue_act3: 4,
  story_canon_teyvat_liyue_chapter1: 1,
  story_canon_teyvat_liyue_interlude: 1,
  story_canon_teyvat_inazuma_chapter2: 1,
  story_canon_teyvat_inazuma_chapter2_storm: 1,
  story_canon_teyvat_inazuma_chapter2_aftermath: 1,
  story_canon_teyvat_sumeru_chapter3: 1,
  story_canon_teyvat_sumeru_chapter3_dream: 1,
  story_canon_teyvat_sumeru_chapter3_worldtree: 1,
  story_canon_teyvat_sumeru_chapter3_farewell: 1,
  story_canon_teyvat_sumeru_chapter3_depart: 1,
  story_canon_teyvat_fontaine_chapter4: 3,
  story_canon_teyvat_natlan_chapter5: 3,
} as const;

const resourceDirectory = join(process.cwd(), 'public', 'data', 'story-weaving-canon');

describe('six-nation canonical scene coverage', () => {
  const allSceneIds = new Set<string>();
  for (const [seriesId, segmentCount] of Object.entries(segmentCounts)) {
    it(`${seriesId} retains old anchors and offers playable scene steps`, () => {
      const raw = JSON.parse(readFileSync(join(resourceDirectory, `${seriesId}.json`), 'utf8'));
      expect(raw.id).toBe(seriesId);
      expect(raw.分段列表.map((segment: { id: string; 组号: number }) => [segment.id, segment.组号]))
        .toEqual(Array.from({ length: segmentCount }, (_, index) => [`${seriesId}_segment_${index + 1}`, index + 1]));
      expect(validateBundledStorySeries(raw)).toEqual([]);
      const series = 归一化剧情编织系列(raw);
      for (const segment of series.分段列表) {
        expect(segment.场景节点?.length, segment.id).toBeGreaterThanOrEqual(2);
        expect(segment.场景节点?.length, segment.id).toBeLessThanOrEqual(5);
        for (const scene of segment.场景节点 ?? []) {
          expect(scene.id.startsWith(`${segment.id}_scene_`), scene.id).toBe(true);
          expect(allSceneIds.has(scene.id), scene.id).toBe(false);
          allSceneIds.add(scene.id);
          expect(scene.标题.trim(), scene.id).not.toBe('');
          expect(scene.地点.trim(), scene.id).not.toBe('');
          expect(scene.参与角色.length, scene.id).toBeGreaterThan(0);
          expect(scene.参与角色.includes('空') && scene.参与角色.includes('荧'), scene.id).toBe(false);
          expect(scene.目标.trim(), scene.id).not.toBe('');
          expect(scene.完成证据.length, scene.id).toBeGreaterThan(0);
          expect(scene.开场事实.length, scene.id).toBeGreaterThan(0);
          expect(scene.完成后事实.length, scene.id).toBeGreaterThan(0);
          expect(scene.可偏离切口.length, scene.id).toBeGreaterThan(0);
          expect(JSON.stringify(scene), scene.id).not.toMatch(/\{\{[^}]+\}\}/u);
        }
      }
    });
  }
});
