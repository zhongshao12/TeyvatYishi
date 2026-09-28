import { describe, expect, it } from 'vitest';
import { mergeBundledStoryWeavingPresets } from '@/data/storyWeavingPreset';
import { 归一化剧情编织分段, 归一化剧情编织系列, 归一化剧情编织系统, type 剧情编织事件, type 剧情编织系列, type 剧情编织系统 } from '@/models/storyWeaving';

function event(name: string): 剧情编织事件 {
  return {
    事件名: name, 事件说明: name, 前置条件: [], 触发条件: [], 阻断条件: [],
    事件结果: [`${name}完成`], 对后续影响: [],
    信息可见性: { 谁知道: [], 谁不知道: [], 是否仅读者视角可见: false },
  };
}

function series(id: string, title: string, content: string, state: '当前' | '已经历' = '当前'): 剧情编织系列 {
  return 归一化剧情编织系列({
    id, 标题: title, 来源类型: 'canon', 内置预设ID: id, 激活注入: true, 当前分段组号: 1,
    分段列表: [归一化剧情编织分段({
      id: `${id}_segment_1`, 组号: 1, 标题: content, 本段概括: content,
      关键事件: [event(content)], 角色推进: [], 处理状态: '已完成', 运行状态: state,
      启用注入: true, 原文内容: content, 字数: content.length,
    }, 1)],
  });
}

function system(items: 剧情编织系列[], current = items[0]?.id): 剧情编织系统 {
  return 归一化剧情编织系统({ 系列列表: items, 当前系列ID: current });
}

describe('bundled story merge', () => {
  it('uses refreshed bundled prose and events while preserving saved runtime state', () => {
    const savedSeries = series('canon-a', '同名章节', '旧剧情');
    savedSeries.激活注入 = false;
    savedSeries.分段列表[0]!.启用注入 = false;
    const bundledSeries = series('canon-a', '同名章节', '新版剧情');
    bundledSeries.分段列表.push({ ...series('canon-b', '后续', '新场景').分段列表[0]!, id: 'canon-a_segment_2', 组号: 2, 运行状态: '未开始' });
    const saved = { ...system([savedSeries]), persistenceVersion: 3 } as 剧情编织系统;

    const merged = mergeBundledStoryWeavingPresets(saved, system([bundledSeries]));
    const refreshed = merged.系列列表[0]!;
    expect(refreshed.分段列表[0]!.标题).toBe('新版剧情');
    expect(refreshed.分段列表[0]!.本段概括).toBe('新版剧情');
    expect(refreshed.分段列表[0]!.关键事件[0]!.事件名).toBe('新版剧情');
    expect(refreshed.分段列表[0]!.启用注入).toBe(false);
    expect(refreshed.激活注入).toBe(false);
    expect(refreshed.分段列表[1]!.运行状态).toBe('未开始');
    expect(merged.当前进度?.当前分段ID).toBe('canon-a_segment_1');
  });

  it('keeps completed segment status and never merges same-title series by name', () => {
    const savedSeries = series('canon-a', '同名章节', '已存旧文案', '已经历');
    const bundledA = series('canon-a', '同名章节', '甲新版');
    const bundledB = series('canon-b', '同名章节', '乙新版');
    const merged = mergeBundledStoryWeavingPresets(
      { ...system([savedSeries]), persistenceVersion: 3 } as 剧情编织系统,
      system([bundledA, bundledB]),
    );
    expect(merged.系列列表[0]!.分段列表[0]!.运行状态).toBe('已经历');
    expect(merged.系列列表[0]!.分段列表[0]!.标题).toBe('甲新版');
    expect(merged.系列列表[1]!.分段列表[0]!.标题).toBe('乙新版');
  });

  it('leaves a custom series and its prose untouched', () => {
    const custom = { ...series('custom-a', '玩家篇章', '玩家原创'), 来源类型: 'custom' as const, 内置预设ID: undefined };
    const merged = mergeBundledStoryWeavingPresets(system([custom]), system([series('canon-a', '章节', '新版')]));
    expect(merged.系列列表.find((item) => item.id === 'custom-a')?.分段列表[0]?.标题).toBe('玩家原创');
  });
});
