import { describe, expect, it } from 'vitest';
import { 归一化剧情编织分段, 归一化剧情编织系列, 归一化剧情编织系统, type 剧情编织进度锚点 } from '@/models/storyWeaving';

const scenes = [
  { id: 'scene-1', 标题: '寻找线索', 地点: '蒙德城', 参与角色: ['安柏'], 目标: '寻找线索', 进入条件: [], 开场事实: [], 完成证据: ['找到信件'], 完成后事实: [], 可偏离切口: ['改向骑士团求助'] },
  { id: 'scene-2', 标题: '交付线索', 地点: '骑士团', 参与角色: ['琴'], 目标: '交付线索', 进入条件: ['找到信件'], 开场事实: [], 完成证据: ['信件已交给琴'], 完成后事实: [], 可偏离切口: ['暂缓交付'] },
];

function makeSystem(anchor: Record<string, unknown> = {}, status: '当前' | '已经历' = '当前') {
  const segment = 归一化剧情编织分段({ id: 'segment-1', 组号: 1, 标题: '序章', 处理状态: '已完成', 运行状态: status, 场景节点: scenes }, 1);
  const baseAnchor: 剧情编织进度锚点 = {
    当前系列ID: 'series-1', 当前分段ID: 'segment-1', 当前分段组号: 1, 推进状态: '推进中',
    已完成摘要: [], 当前待解问题: [], 切换说明: [], 历史归档: [], 最近判定理由: [], updatedAt: 1,
  };
  return 归一化剧情编织系统({
    系列列表: [归一化剧情编织系列({ id: 'series-1', 标题: '蒙德', 来源类型: 'canon', 内置预设ID: 'series-1', 分段列表: [segment], 激活注入: true, 当前分段组号: 1 })],
    当前系列ID: 'series-1',
    当前进度: { ...baseAnchor, ...anchor },
  });
}

describe('story scene model', () => {
  it('initializes a legacy active anchor at the first unproven scene', () => {
    const system = makeSystem();
    expect(system.系列列表[0]?.分段列表[0]?.场景节点?.map((scene) => scene.id)).toEqual(['scene-1', 'scene-2']);
    expect(system.当前进度?.当前场景ID).toBe('scene-1');
    expect(system.当前进度?.已完成场景ID).toEqual([]);
  });

  it('drops an unknown saved scene ID instead of skipping scene one', () => {
    const system = makeSystem({ 当前场景ID: 'deleted-scene', 已完成场景ID: ['deleted-scene'] });
    expect(system.当前进度?.当前场景ID).toBe('scene-1');
    expect(system.当前进度?.已完成场景ID).toEqual([]);
  });

  it('does not reopen a completed segment from a legacy save', () => {
    const system = makeSystem({}, '已经历');
    expect(system.当前进度?.当前场景ID).toBeUndefined();
  });
});
