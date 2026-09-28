import { describe, expect, it } from 'vitest';
import { 归一化剧情编织分段, 归一化剧情编织系列, 归一化剧情编织系统, type 剧情编织进度锚点 } from '@/models/storyWeaving';
import { advanceStorySceneProgress } from '@/services/storySceneProgress';
import { autoAlignCanonStoryProgress } from '@/services/storyProgressService';

const segment = 归一化剧情编织分段({
  id: 'segment-1', 组号: 1, 标题: '调查', 处理状态: '已完成', 运行状态: '当前',
  场景节点: [
    { id: 'scene-1', 标题: '寻琴', 地点: '蒙德', 参与角色: [], 目标: '找到琴', 进入条件: [], 开场事实: [], 完成证据: ['拿到了天空之琴'], 完成后事实: [], 可偏离切口: ['另寻办法'] },
    { id: 'scene-2', 标题: '还琴', 地点: '教堂', 参与角色: [], 目标: '归还琴', 进入条件: [], 开场事实: [], 完成证据: ['天空之琴已归还'], 完成后事实: [], 可偏离切口: ['暂缓归还'] },
  ],
}, 1);

const anchor = {
  当前系列ID: 'series-1', 当前分段ID: 'segment-1', 当前分段组号: 1, 推进状态: '推进中',
  已完成摘要: [], 当前待解问题: [], 切换说明: [], 历史归档: [], 最近判定理由: [],
  当前场景ID: 'scene-1', 已完成场景ID: [], updatedAt: 1,
} satisfies 剧情编织进度锚点;

function advance(body: string, turnCount = 3, current = segment, progress: 剧情编织进度锚点 = anchor): 剧情编织进度锚点 {
  return advanceStorySceneProgress({ segment: current, anchor: progress, userInput: '调查天空之琴的下落', body, turnCount });
}

describe('evidence-backed scene progress', () => {
  it('advances only one scene after an explicit completed result', () => {
    const result = advance('众人拿到了天空之琴。随后天空之琴已归还。');
    expect(result.当前场景ID).toBe('scene-2');
    expect(result.已完成场景ID).toEqual(['scene-1']);
    expect(advance('天空之琴已归还。', 3, segment, result)).toBe(result);
  });

  it('does not complete a scene from a mention or a negated result', () => {
    expect(advance('大家谈起天空之琴，却没有拿到天空之琴。')).toBe(anchor);
    expect(advance('琴说下一步要拿到了天空之琴，先别急。')).toBe(anchor);
    expect(advance('假如大家真的拿到了天空之琴，计划才有机会继续。')).toBe(anchor);
    expect(advanceStorySceneProgress({ segment, anchor, userInput: '我在旅店睡觉', body: '与此同时，众人拿到了天空之琴。', turnCount: 3 })).toBe(anchor);
  });

  it('never reopens an archived segment', () => {
    expect(advance('众人拿到了天空之琴。', 3, { ...segment, 运行状态: '已经历' })).toBe(anchor);
    expect(advance('众人拿到了天空之琴。', 3, { ...segment, 运行状态: '已跳过' })).toBe(anchor);
    expect(advance('众人拿到了天空之琴。', 3, { ...segment, 运行状态: '已偏离' })).toBe(anchor);
  });

  it('persists the scene cursor through the existing chapter alignment workflow', () => {
    const storyWeaving = 归一化剧情编织系统({
      系列列表: [归一化剧情编织系列({ id: 'series-1', 标题: '蒙德', 来源类型: 'canon', 内置预设ID: 'series-1', 分段列表: [segment], 激活注入: true, 当前分段组号: 1 })],
      当前系列ID: 'series-1', 当前进度: anchor,
    });
    const result = autoAlignCanonStoryProgress({ storyWeaving, turnCount: 3, userInput: '调查天空之琴的下落', body: '众人拿到了天空之琴。' });
    expect(result.system.当前进度?.当前场景ID).toBe('scene-2');
    expect(result.system.当前进度?.已完成场景ID).toEqual(['scene-1']);
  });

  it('keeps a divergent route marked divergent after a diagnostic-only turn', () => {
    const storyWeaving = 归一化剧情编织系统({
      系列列表: [归一化剧情编织系列({ id: 'series-1', 标题: '蒙德', 来源类型: 'canon', 内置预设ID: 'series-1', 分段列表: [segment], 激活注入: true, 当前分段组号: 1 })],
      当前系列ID: 'series-1', 当前进度: { ...anchor, 推进状态: '已偏离' },
    });
    const result = autoAlignCanonStoryProgress({ storyWeaving, turnCount: 3, userInput: '我去城里问路', body: '我在街口与守卫谈话。' });
    expect(result.system.当前进度?.推进状态).toBe('已偏离');
  });

  it('does not archive a multi-scene chapter from two general activity turns', () => {
    const currentSegment = { ...segment, 登场角色: ['安柏', '派蒙'], 涉及地点: ['蒙德城'] };
    const storyWeaving = 归一化剧情编织系统({
      系列列表: [归一化剧情编织系列({ id: 'series-1', 标题: '蒙德', 来源类型: 'canon', 内置预设ID: 'series-1', 分段列表: [currentSegment], 激活注入: true, 当前分段组号: 1 })],
      当前系列ID: 'series-1', 当前进度: anchor,
    });
    const gateSnapshot = { mode: 'strong' as const, reasons: ['地点命中'] };
    const first = autoAlignCanonStoryProgress({ storyWeaving, turnCount: 3, gateSnapshot, userInput: '继续和安柏、派蒙调查蒙德城', body: '安柏和派蒙检查蒙德城门线索。' });
    const second = autoAlignCanonStoryProgress({ storyWeaving: first.system, turnCount: 4, gateSnapshot, userInput: '继续和安柏、派蒙调查蒙德城', body: '安柏和派蒙继续检查蒙德城的线索。' });
    expect(second.system.系列列表[0]?.分段列表[0]?.运行状态).toBe('当前');
    expect(second.system.当前进度?.已完成场景ID ?? []).toEqual([]);
  });
});
