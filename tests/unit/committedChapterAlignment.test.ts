import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { 归一化剧情编织分段, 归一化剧情编织系列, 归一化剧情编织系统 } from '@/models/storyWeaving';
import { commitTurnContext, planPostSettlementStoryAlignment, resolveStoryWeavingForBackgroundWrite } from '@/hooks/useGame/postSettlementCommitStage';
import { getCurrentStoryChapterLabel } from '@/services/storyProgressService';

const chapter = (id: string, group: number, title: string, status: '已经历' | '未开始') =>
  归一化剧情编织分段({ id, 组号: group, 标题: title, 处理状态: '已完成', 运行状态: status }, group);

describe('committed chapter alignment', () => {
  it('publishes the next chapter with the exact settled world clock', () => {
    const base = createEmptyTeyvatGameState();
    base.世界.当前日期 = '旅行历 1000.03.08';
    base.世界.当前时间 = '14:00';
    const story = 归一化剧情编织系统({
      系列列表: [归一化剧情编织系列({
        id: 'mondstadt', 标题: '蒙德序章', 激活注入: true, 当前分段组号: 1,
        分段列表: [chapter('first', 1, '第一幕', '已经历'), chapter('second', 2, '第二幕', '未开始')],
      })],
      当前系列ID: 'mondstadt',
      当前进度: { 当前系列ID: 'mondstadt', 当前分段ID: 'first', 当前分段组号: 1, 推进状态: '已完成', 已完成摘要: [], 当前待解问题: [], 切换说明: [], 历史归档: [], 最近判定理由: [], updatedAt: 1 },
    });
    const aligned = planPostSettlementStoryAlignment({
      openingSystemTurn: false, storyWeaving: story, turn: 3,
      userInput: '继续旅行', body: '众人继续上路。', currentLocation: '蒙德城',
    }).alignment.system;
    const committed = commitTurnContext({ game: base, storyWeaving: aligned, settlementId: 'turn-3' });
    expect(committed.context.moment.clock).toBe('14:00');
    expect(getCurrentStoryChapterLabel(committed.context.storyWeaving)).toContain('第二幕');
    expect(committed.game.叙事.lastCommittedMoment).toEqual(committed.context.moment);
    const replay = commitTurnContext({ game: committed.game, storyWeaving: aligned, settlementId: 'turn-3' });
    expect(replay.context.moment).toBe(committed.context.moment);
    expect(getCurrentStoryChapterLabel(replay.context.storyWeaving)).toBe(getCurrentStoryChapterLabel(committed.context.storyWeaving));
  });

  it('preserves a concurrent story edit and reports it rather than overwriting it', async () => {
    const base = 归一化剧情编织系统({
      当前系列ID: 'old',
      系列列表: [归一化剧情编织系列({ id: 'old', 标题: '原章节', 激活注入: true })],
    });
    const proposed = { ...base, 系列列表: [{ ...base.系列列表[0]!, 标题: '自动推进' }] };
    const latest = { ...base, 系列列表: [{ ...base.系列列表[0]!, 标题: '玩家手动修改' }] };
    const resolved = await resolveStoryWeavingForBackgroundWrite({
      workflowBase: base, proposed, loadLatest: async () => latest,
    });
    expect(resolved.concurrentChange).toBe(true);
    expect(resolved.system.系列列表[0]?.标题).toBe('玩家手动修改');
  });

  it('keeps the current chapter when the story gate is soft and explains the hold', () => {
    const story = 归一化剧情编织系统({
      当前系列ID: 'mondstadt',
      系列列表: [归一化剧情编织系列({
        id: 'mondstadt', 标题: '蒙德序章', 激活注入: true, 当前分段组号: 1,
        分段列表: [
          归一化剧情编织分段({ id: 'first', 组号: 1, 标题: '第一幕', 处理状态: '已完成', 运行状态: '当前' }, 1),
          chapter('second', 2, '第二幕', '未开始'),
        ],
      })],
    });
    const plan = planPostSettlementStoryAlignment({
      openingSystemTurn: false, storyWeaving: story, turn: 3,
      userInput: '继续对话', body: '大家在营地闲聊。',
      gateSnapshot: { mode: 'soft', reasons: ['关键场景尚未完成'] },
    });
    expect(getCurrentStoryChapterLabel(plan.alignment.system)).toContain('第一幕');
    expect(plan.warning).toContain('关键场景尚未完成');
  });
});
