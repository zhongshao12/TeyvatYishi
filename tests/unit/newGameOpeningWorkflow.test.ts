import { describe, expect, it, vi } from 'vitest';
import { prepareNewGameState } from '@/hooks/useGame/newGameOpening';
import { toLegacyTraveler, toLegacyWorld } from '@/hooks/useGameState';
import { 创建空剧情编织系统, 归一化剧情编织系列 } from '@/models/storyWeaving';
import { createEmptyTeyvatGameState } from '@/models/teyvat';

const empty = createEmptyTeyvatGameState();
const traveler = { ...toLegacyTraveler(empty), 姓名: '云' };
const world = toLegacyWorld(empty);

describe('new-game opening transaction', () => {
  it('falls back to an empty current-run story when loading fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await prepareNewGameState({
        traveler, world, initialNpcs: [], codexCatalog: empty.图鉴,
        loadStoryWeaving: async () => { throw new Error('offline'); },
      });
      expect(result.storyWeaving).toEqual(创建空剧情编织系统());
      expect(result.game.叙事.storyWeaving?.series).toEqual([]);
      expect(result.game.背包).toEqual(createEmptyTeyvatGameState().背包);
      expect(result.game.任务).toEqual(createEmptyTeyvatGameState().任务);
    } finally {
      warning.mockRestore();
    }
  });

  it('aligns freshly loaded canon story to this opening only', async () => {
    const source = {
      系列列表: [归一化剧情编织系列({ id: 'canon-mondstadt', 来源类型: 'canon', 激活注入: true })],
      当前系列ID: 'canon-mondstadt',
    };
    const result = await prepareNewGameState({
      traveler,
      world: { ...world, 开局档案: {
        来源: 'official_preset', 主线启用: false, 地区ID: 'mondstadt', 地区名称: '蒙德',
        章节锚点ID: '', 章节锚点名称: '', 章节参考说明: '', 参考性质: '背景参考',
        玩家介入原文: '', 防回退规则: [],
      } },
      initialNpcs: [], codexCatalog: empty.图鉴,
      loadStoryWeaving: async () => source,
    });
    expect(result.storyWeaving.系列列表[0]?.激活注入).toBe(false);
    expect(result.game.叙事.storyWeaving?.series[0]?.active).toBe(false);
  });
});
