import { describe, expect, it } from 'vitest';
import {
  检测多个当前分段,
  检测原著事件重演,
  检测事实与时间线矛盾,
  检测偏离段缺失回归路径,
  生成冲突报告,
  应用冲突修复,
} from '../../services/storyWeavingConflict';
import type { 剧情编织系列, 剧情编织系统, 剧情编织分段 } from '../../models/storyWeaving';
import { createEmptyCanonTrack } from '../../models/teyvat/canon';
import { recordCanonDeviation } from '../../services/canonDeviationService';

function 段(id: string, 组号: number, 标题: string, 运行状态: 剧情编织分段['运行状态']): 剧情编织分段 {
  return {
    id, 组号, 标题, 章节范围: '', 章节标题: [], 是否开局组: false, 起始章序号: 1, 结束章序号: 1,
    启用注入: true, 原文内容: '', 字数: 0, 原文摘要: '', 本段概括: '', 时间线起点: '', 时间线终点: '',
    开局已成立事实: [], 前段延续事实: [], 本段结束状态: [], 给后续参考: [], 原著硬约束: [],
    可提前铺垫: [], 登场角色: [], 涉及地点: [], 涉及派系: [], 角色档案: [], 势力档案: [], 地图地点档案: [],
    关键事件: [], 时间线: [], 角色推进: [], 处理状态: '已完成', 运行状态, updatedAt: 1,
  };
}

function 系列(id: string, 分段列表: 剧情编织分段[], 来源类型: 'canon' | 'custom' = 'custom'): 剧情编织系列 {
  return {
    id, 标题: id, 作品名: '原神', 来源类型, 来源图鉴条目ID: [], 章节列表: [],
    分段列表, 每段章数: 1, 激活注入: true, 当前分段组号: 1, 当前阶段概括: '', 核心角色摘要: [],
    核心角色: [], 涉及地点索引: [], 涉及派系索引: [], createdAt: 1, updatedAt: 1,
  };
}

describe('storyWeavingConflict', () => {
  it('detects multiple active segments', () => {
    const series = 系列('s1', [段('seg1', 1, 'A', '当前'), 段('seg2', 2, 'B', '当前')]);
    const conflicts = 检测多个当前分段(series);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0]!.规则ID).toBe('multiple_active_segments');
    expect(conflicts[0]!.严重度).toBe('error');
  });

  it('detects canon event replay for an unstarted segment', () => {
    const seg = 段('seg1', 1, '黑塔空间站风波', '未开始');
    seg.关键事件 = [{ 事件名: '反物质军团入侵', 事件说明: '', 前置条件: [], 触发条件: [], 阻断条件: [], 事件结果: [], 对后续影响: [], 信息可见性: { 谁知道: [], 谁不知道: [], 是否仅读者视角可见: false } }];
    const system: 剧情编织系统 = { 系列列表: [系列('s1', [seg], 'canon')] };
    const conflicts = 检测原著事件重演(system, ['反物质军团入侵已经发生']);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.规则ID).toBe('canon_event_replay');
  });

  it('flags a blocked Teyvat anchor even when legacy keyword matching would otherwise advance it', () => {
    const blocked = 段('seg2', 1, '没有眼泪的明天', '未开始');
    const system: 剧情编织系统 = {
      系列列表: [系列('story_canon_teyvat_mondstadt_prologue_act2', [blocked], 'canon')],
    };
    const canonTrack = recordCanonDeviation(createEmptyCanonTrack(), {
      anchorId: 'teyvat_prologue_mondstadt_act1',
      turn: 7,
      evidence: ['玩家已改变龙灾结果'],
      affectedCharacters: ['温迪'],
      worldEffects: ['天空之琴路线失效'],
      blockedAnchorIds: ['teyvat_prologue_mondstadt_act2'],
      status: 'active',
      returnability: 'none',
    });

    const conflicts = 检测原著事件重演(system, ['没有眼泪的明天已经开始'], canonTrack);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.规则ID).toBe('canon_event_replay');
    expect(conflicts[0]!.描述).toContain('teyvat_prologue_mondstadt_act2');
  });

  it('reports canon-wide blocked-anchor warnings exactly once while preserving per-series conflict order', () => {
    const first = 系列('custom-first', [段('first-1', 1, '第一段', '当前'), 段('first-2', 2, '第二段', '当前')]);
    const blocked = 系列('story_canon_teyvat_mondstadt_prologue_act2', [
      段('blocked-current-1', 1, '被阻断当前一', '当前'),
      段('blocked-current-2', 2, '被阻断当前二', '当前'),
      段('blocked-future', 3, '不得重演的原著结果', '未开始'),
    ], 'canon');
    const system: 剧情编织系统 = { 系列列表: [first, blocked] };
    const canonTrack = recordCanonDeviation(createEmptyCanonTrack(), {
      anchorId: 'teyvat_prologue_mondstadt_act1',
      turn: 7,
      evidence: ['玩家已改变龙灾结果'],
      affectedCharacters: ['温迪'],
      worldEffects: ['原著第二幕不再成立'],
      blockedAnchorIds: ['teyvat_prologue_mondstadt_act2'],
      status: 'active',
      returnability: 'none',
    });

    const conflicts = 生成冲突报告(system, [], canonTrack);
    const canonWarnings = conflicts.filter((conflict) => conflict.规则ID === 'canon_event_replay');
    const perSeriesErrors = conflicts.filter((conflict) => conflict.规则ID === 'multiple_active_segments');

    expect(canonWarnings).toHaveLength(1);
    expect(canonWarnings[0]!.分段ID).toBe('blocked-future');
    expect(perSeriesErrors.map((conflict) => conflict.系列ID)).toEqual(['custom-first', 'story_canon_teyvat_mondstadt_prologue_act2']);
  });

  it('detects timeline contradiction when a later event predates an earlier unstarted segment', () => {
    const later = 段('seg2', 2, 'B', '已经历');
    later.关键事件 = [{ 事件名: '抵达匹诺康尼', 事件说明: '', 前置条件: [], 触发条件: [], 阻断条件: [], 事件结果: [], 对后续影响: [], 信息可见性: { 谁知道: [], 谁不知道: [], 是否仅读者视角可见: false } }];
    const system: 剧情编织系统 = { 系列列表: [系列('s1', [段('seg1', 1, 'A', '未开始'), later], 'canon')] };
    const conflicts = 检测事实与时间线矛盾(system, ['玩家已抵达匹诺康尼']);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.规则ID).toBe('fact_timeline_contradiction');
  });

  it('flags diverged segments without a later route', () => {
    const system: 剧情编织系统 = { 系列列表: [系列('s1', [段('seg1', 1, 'A', '已偏离')])] };
    const conflicts = 检测偏离段缺失回归路径(system);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.规则ID).toBe('diverged_segment_no_rejoin');
  });

  it('applies mark_skip fix and collapses multiple active segments', () => {
    const series = 系列('s1', [段('seg1', 1, 'A', '当前'), 段('seg2', 2, 'B', '当前')]);
    const system: 剧情编织系统 = { 系列列表: [series] };
    const conflicts = 生成冲突报告(system, []);
    expect(conflicts.length).toBeGreaterThan(0);
    const fixed = 应用冲突修复(system, conflicts[0]!);
    const active = fixed.系列列表[0]!.分段列表.filter((seg) => seg.运行状态 === '当前');
    expect(active).toHaveLength(1);
  });

describe('storyWeavingConflict extra branches', () => {
  it('returns no conflict for a single active segment', () => {
    const series = 系列('s1', [段('seg1', 1, 'A', '当前')]);
    expect(检测多个当前分段(series)).toHaveLength(0);
  });

  it('skips custom series in canon replay detection', () => {
    const seg = 段('seg1', 1, '黑塔空间站风波', '未开始');
    seg.关键事件 = [{ 事件名: '反物质军团入侵', 事件说明: '', 前置条件: [], 触发条件: [], 阻断条件: [], 事件结果: [], 对后续影响: [], 信息可见性: { 谁知道: [], 谁不知道: [], 是否仅读者视角可见: false } }];
    const system: 剧情编织系统 = { 系列列表: [系列('s1', [seg], 'custom')] };
    expect(检测原著事件重演(system, ['反物质军团入侵已经发生'])).toHaveLength(0);
  });

  it('ignores empty or unmatched facts in replay detection', () => {
    const seg = 段('seg1', 1, '黑塔空间站风波', '未开始');
    const system: 剧情编织系统 = { 系列列表: [系列('s1', [seg], 'canon')] };
    expect(检测原著事件重演(system, [])).toHaveLength(0);
    expect(检测原著事件重演(system, ['无关事实'])).toHaveLength(0);
  });

  it('does not flag timeline contradiction when earlier segments are experienced', () => {
    const later = 段('seg2', 2, 'B', '已经历');
    later.关键事件 = [{ 事件名: '抵达匹诺康尼', 事件说明: '', 前置条件: [], 触发条件: [], 阻断条件: [], 事件结果: [], 对后续影响: [], 信息可见性: { 谁知道: [], 谁不知道: [], 是否仅读者视角可见: false } }];
    const system: 剧情编织系统 = { 系列列表: [系列('s1', [段('seg1', 1, 'A', '已经历'), later], 'canon')] };
    expect(检测事实与时间线矛盾(system, ['玩家已抵达匹诺康尼'])).toHaveLength(0);
    expect(检测事实与时间线矛盾(system, [])).toHaveLength(0);
  });

  it('allows diverged segments when a later route exists', () => {
    const system: 剧情编织系统 = { 系列列表: [系列('s1', [段('seg1', 1, 'A', '已偏离'), 段('seg2', 2, 'B', '未开始')])] };
    expect(检测偏离段缺失回归路径(system)).toHaveLength(0);
  });

  it('applies mark_diverged and rejoin fixes, and demotes other active segments on rejoin', () => {
    const series = 系列('s1', [段('seg1', 1, 'A', '当前'), 段('seg2', 2, 'B', '已偏离')]);
    const system: 剧情编织系统 = { 系列列表: [series] };
    const diverged = 生成冲突报告(system, [])[0]!;
    const marked = 应用冲突修复(system, { ...diverged, 建议动作: 'mark_diverged' });
    expect(marked.系列列表[0]!.分段列表[1]!.运行状态).toBe('已偏离');

    const rejoin = 应用冲突修复(system, { ...diverged, 分段ID: 'seg2', 建议动作: 'rejoin' });
    const segments = rejoin.系列列表[0]!.分段列表;
    expect(segments.find((s) => s.id === 'seg2')?.运行状态).toBe('当前');
    expect(segments.filter((s) => s.运行状态 === '当前')).toHaveLength(1);
  });

  it('returns the system unchanged for dismiss, missing segment id, or id mismatches', () => {
    const series = 系列('s1', [段('seg1', 1, 'A', '当前')]);
    const system: 剧情编织系统 = { 系列列表: [series] };
    const base = 生成冲突报告(system, [])[0]!;
    expect(应用冲突修复(system, { ...base, 建议动作: 'dismiss' })).toBe(system);
    expect(应用冲突修复(system, { ...base, 分段ID: undefined })).toBe(system);
    expect(应用冲突修复(system, { ...base, 系列ID: 'other' }).系列列表[0]!.分段列表[0]!.运行状态).toBe('当前');
    expect(应用冲突修复(system, { ...base, 分段ID: 'missing' }).系列列表[0]!.分段列表[0]!.运行状态).toBe('当前');
  });
});

});
