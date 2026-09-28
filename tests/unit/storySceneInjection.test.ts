import { describe, expect, it } from 'vitest';
import { 归一化剧情编织分段, 归一化剧情编织系列, 归一化剧情编织系统, type 剧情编织场景节点, type 剧情编织进度锚点 } from '@/models/storyWeaving';
import { buildStoryWeavingInjection } from '@/services/storyWeaving';

const visible = { 谁知道: ['安柏'], 谁不知道: ['丽莎'], 是否仅读者视角可见: false };
const hidden = { 谁知道: [], 谁不知道: [], 是否仅读者视角可见: true };

function scene(id: string, title: string, goal: string): 剧情编织场景节点 {
  return {
    id, 标题: title, 地点: '蒙德城', 参与角色: ['安柏'], 目标: goal, 进入条件: [],
    开场事实: [], 完成证据: ['信件已交付'], 完成后事实: [], 可偏离切口: ['先去骑士团求助'],
  };
}

function system(scenes: 剧情编织场景节点[], progress: Partial<剧情编织进度锚点> = {}) {
  const segment = 归一化剧情编织分段({
    id: 'segment-1', 组号: 1, 标题: '蒙德序章', 处理状态: '已完成', 运行状态: '当前',
    本段概括: '在蒙德城调查异常', 涉及地点: ['蒙德城'], 登场角色: ['安柏'], 场景节点: scenes,
  }, 1);
  const series = 归一化剧情编织系列({
    id: 'series-1', 标题: '蒙德篇', 来源类型: 'canon', 内置预设ID: 'series-1',
    分段列表: [segment], 当前分段组号: 1, 激活注入: true,
  });
  const anchor: 剧情编织进度锚点 = {
    当前系列ID: 'series-1', 当前分段ID: 'segment-1', 当前分段组号: 1, 推进状态: '推进中',
    已完成摘要: [], 当前待解问题: [], 切换说明: [], 历史归档: [], 最近判定理由: [], updatedAt: 1,
    ...progress,
  };
  return 归一化剧情编织系统({ 系列列表: [series], 当前系列ID: 'series-1', 当前进度: anchor });
}

const strongContext = { currentLocation: '蒙德城', recentUserInput: '我和安柏进入蒙德城调查', recentAIResponse: '' };

describe('story scene prompt window', () => {
  it('shows active goal and known facts, but not reader-only or uncompleted results', () => {
    const current = scene('scene-1', '城门调查', '核对城门信件');
    current.参与角色 = ['安柏', '丽莎'];
    current.开场事实 = [
      { 内容: '安柏已见过送信人', 信息可见性: visible },
      { 内容: '女皇秘密计划', 信息可见性: hidden },
    ];
    current.完成后事实 = [{ 内容: '信件已经送达骑士团', 信息可见性: visible }];
    const result = buildStoryWeavingInjection(system([
      current, scene('scene-2', '骑士团会面', '讨论如何追查'), scene('scene-3', '远方终局', '终局结算'),
    ]), strongContext);
    expect(result).toContain('核对城门信件');
    expect(result).toContain('可涉及角色（仅实际在场者）：安柏、丽莎');
    expect(result).toContain('完成判据（仅实际达成后表述）：信件已交付');
    expect(result).toContain('安柏已见过送信人');
    expect(result).toContain('丽莎未知');
    expect(result).toContain('骑士团会面');
    expect(result).not.toContain('女皇秘密计划');
    expect(result).not.toContain('信件已经送达骑士团');
    expect(result).not.toContain('讨论如何追查');
    expect(result).not.toContain('远方终局');
  });

  it('keeps objective and result spoilers out of a soft gate', () => {
    const current = scene('scene-1', '城门调查', '核对城门信件');
    current.完成后事实 = [{ 内容: '信件已经送达骑士团', 信息可见性: visible }];
    const result = buildStoryWeavingInjection(system([current]), { recentUserInput: '', recentAIResponse: '' });
    expect(result).toContain('城门调查');
    expect(result).not.toContain('核对城门信件');
    expect(result).not.toContain('信件已经送达骑士团');
  });

  it('keeps divergent status and bounds a large scene collection', () => {
    const scenes = Array.from({ length: 20 }, (_, index) => scene(`scene-${index + 1}`, `场景${index + 1}`, '漫长目标'.repeat(500)));
    scenes[0]!.开场事实 = [{ 内容: '很长的已知事实'.repeat(500), 信息可见性: visible }];
    const result = buildStoryWeavingInjection(system(scenes, { 推进状态: '已偏离' }), strongContext);
    expect(result).toContain('已偏离');
    expect(result).toContain('场景1');
    expect(result).toContain('场景2');
    expect(result).not.toContain('场景3');
    expect(result.length).toBeLessThan(6000);
  });
});
