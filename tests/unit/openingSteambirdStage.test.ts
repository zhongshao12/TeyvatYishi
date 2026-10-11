import { describe, expect, it } from 'vitest';
import { createEmptySteambirdNews } from '@/models/teyvat';
import { buildOpeningSteambirdPreprocess } from '@/hooks/useGame/openingSteambirdStage';

describe('opening Steambird preprocessing stage', () => {
  it('does not publish private opening configuration as public news', () => {
    const result = buildOpeningSteambirdPreprocess({
      current: createEmptySteambirdNews(),
      turnCount: 1,
      now: 123,
      world: {
        当前地点: '蒙德 · 低语森林',
        起航之地ID: 'mondstadt',
        原著主角: '荧',
        开局档案: {
          地区名称: '蒙德',
          章节锚点名称: '捕风的异乡人',
          章节参考说明: '旅行者刚进入蒙德地区。',
          玩家介入原文: '玩家在林间苏醒。',
          整理档案: { 特别要求: ['保持开局信息边界'] },
        },
      } as never,
    });

    expect(result).toBeNull();
  });
});
