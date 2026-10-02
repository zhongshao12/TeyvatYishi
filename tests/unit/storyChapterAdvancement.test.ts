import { describe, expect, it } from 'vitest';
import { autoAlignCanonStoryProgress, getCurrentStoryChapterLabel, 分段可参与推进 } from '@/services/storyProgressService';
import type { 剧情编织分段, 剧情编织系列, 剧情编织系统 } from '@/models/storyWeaving';
import { 归一化剧情编织系列 } from '@/models/storyWeaving';

/**
 * 用户第 2 项：「剧情主线明明已经到了另一节点，但是当前篇章一直没有变动」。
 *
 * 根因（代码取证，不是标签查表）：`处理状态` 表达的是「本段**是否已被模型分解**」
 * （有本段概括/原文摘要才能注入正文），但推进侧的五处筛选把它当成了「能否参与推进」：
 * `services/storyProgressService.ts:38`（候选集）、`:73`（**当前分段不是「已完成」就整段放弃**）、
 * `:295`（跨系列候选）。自定义导入的章节只有大纲、分段停在 `待处理`，
 * 于是「推进」永远不会发生、连「为什么不推进」的原因都不会写。
 */

function 段(
  id: string,
  组号: number,
  标题: string,
  运行状态: 剧情编织分段['运行状态'],
  处理状态: 剧情编织分段['处理状态'] = '已完成',
  场景节点: 剧情编织分段['场景节点'] = [],
): 剧情编织分段 {
  return {
    id, 组号, 标题, 章节范围: '', 章节标题: [标题], 是否开局组: 组号 === 1, 起始章序号: 组号, 结束章序号: 组号,
    启用注入: true, 原文内容: '', 字数: 0, 原文摘要: '', 本段概括: '', 时间线起点: '', 时间线终点: '',
    开局已成立事实: [], 前段延续事实: [], 本段结束状态: [], 给后续参考: [], 原著硬约束: [],
    可提前铺垫: [], 登场角色: [], 涉及地点: [], 涉及派系: [], 角色档案: [], 势力档案: [], 地图地点档案: [],
    关键事件: [], 时间线: [], 角色推进: [], 场景节点, 处理状态, 运行状态, updatedAt: 1,
  };
}

function 系列(分段列表: 剧情编织分段[], 当前分段组号 = 1): 剧情编织系列 {
  return {
    id: 's1', 标题: '自定义篇章', 作品名: '原神', 来源类型: 'custom', 来源图鉴条目ID: [], 章节列表: [],
    分段列表, 每段章数: 1, 激活注入: true, 当前分段组号, 当前阶段概括: '', 核心角色摘要: [],
    核心角色: [], 涉及地点索引: [], 涉及派系索引: [], createdAt: 1, updatedAt: 1,
  };
}

function 系统(series: 剧情编织系列): 剧情编织系统 {
  return {
    系列列表: [series], 当前系列ID: series.id, 当前进度: undefined as never, 最近判定理由: [],
    createdAt: 1, updatedAt: 1,
  } as unknown as 剧情编织系统;
}

describe('篇章推进不再被「待处理」卡死（2026-09-29 第 2 项）', () => {
  it('锚点已归档时会迁移到下一段，即使下一段尚未被分解（待处理）', () => {
    const system = 系统(系列([
      段('seg1', 1, '第一章', '已经历'),
      段('seg2', 2, '第二章', '未开始', '待处理'),
    ]));
    const result = autoAlignCanonStoryProgress({ storyWeaving: system, turnCount: 5, body: '', userInput: '' });
    expect(result.changed).toBe(true);
    const series = result.system.系列列表[0]!;
    // 权威值是锚点 + 分段的运行状态（`getCurrentSegment` 优先读锚点）。
    expect(series.分段列表.find((segment) => segment.id === 'seg2')?.运行状态).toBe('当前');
    expect(result.system.当前进度?.当前分段ID).toBe('seg2');
    expect(result.system.当前进度?.当前分段组号).toBe(2);
  });

  it('系列上的「当前分段组号」镜像必须跟随运行中的分段（单源修正）', () => {
    const normalized = 归一化剧情编织系列(系列([
      段('seg1', 1, '第一章', '已经历'),
      段('seg2', 2, '第二章', '未开始', '待处理'),
    ]));
    expect(normalized.分段列表.find((segment) => segment.id === 'seg2')?.运行状态).toBe('当前');
    expect(normalized.当前分段组号).toBe(2);
  });

  it('失败分段不参与推进（保留负向边界）', () => {
    const failed = 段('seg2', 2, '第二章', '未开始', '失败');
    expect(分段可参与推进(failed)).toBe(false);
    const result = autoAlignCanonStoryProgress({
      storyWeaving: 系统(系列([段('seg1', 1, '第一章', '当前', '已完成'), failed])),
      turnCount: 5,
      body: '队伍抵达蒙德。',
      userInput: '继续前进。',
    });
    expect(result.progressed).toBe(false);
    expect(result.system.系列列表[0]?.分段列表.find((segment) => segment.id === 'seg2')?.运行状态).toBe('未开始');
  });

  it('当前段未分解时不再整段放弃：至少要写出「为什么不推进」的原因', () => {
    const system = 系统(系列([
      段('seg1', 1, '第一章', '当前', '待处理', [{ id: 'scene1', 标题: '抵达蒙德', 关键词: ['蒙德'] } as never]),
      段('seg2', 2, '第二章', '未开始', '待处理'),
    ]));
    const result = autoAlignCanonStoryProgress({
      storyWeaving: system, turnCount: 5, userInput: '我们抵达了蒙德。', body: '队伍抵达蒙德，风车在头顶转动。',
    });
    // 未推进是对的（证据不足），但**不能**像旧实现那样直接 return 原系统、连诊断都不写。
    expect(result.progressed).toBe(false);
    expect(result.changed).toBe(true);
    const anchorReasons = (result.system.当前进度?.最近判定理由 ?? []) as string[];
    expect(anchorReasons.length).toBeGreaterThan(0);
  });

  it('当前篇章标签跟随推进后的分段', () => {
    const system = 系统(系列([
      段('seg1', 1, '第一章', '已经历'),
      段('seg2', 2, '第二章', '未开始', '待处理'),
    ]));
    const result = autoAlignCanonStoryProgress({ storyWeaving: system, turnCount: 5, body: '', userInput: '' });
    expect(getCurrentStoryChapterLabel(result.system)).toBe('自定义篇章 · 第二章');
  });
});
