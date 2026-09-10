import { describe, expect, it } from 'vitest';
import type { 剧情编织分段, 剧情编织系列, 剧情编织系统 } from '@/models/storyWeaving';
import { createEmptyCanonTrack, type CanonDeviation, type CanonDeviationInput } from '@/models/teyvat/canon';
import { normalizeTeyvatGameState } from '@/models/teyvat/state';
import {
  buildCanonContextWindow,
  mergeCanonDeviation,
  normalizeCanonDeviation,
  normalizeCanonTrack,
  recordCanonDeviation,
} from '@/services/canonDeviationService';
import { autoAlignCanonStoryProgress } from '@/services/storyProgressService';
import { buildStoryWeavingInjection } from '@/services/storyWeaving';

const BASE_INPUT: CanonDeviationInput = {
  anchorId: 'teyvat_prologue_mondstadt_act1',
  turn: 7,
  evidence: ['玩家保护了本应受伤的侦察骑士'],
  affectedCharacters: ['安柏'],
  worldEffects: ['蒙德城门的战备路线改变'],
  blockedAnchorIds: ['teyvat_prologue_mondstadt_act2'],
  status: 'active',
  returnability: 'conditional',
};

function segment(id: string, group: number, status: 剧情编织分段['运行状态']): 剧情编织分段 {
  return {
    id,
    组号: group,
    标题: group === 1 ? '城门与龙灾' : '没有眼泪的明天',
    章节范围: '', 章节标题: [], 是否开局组: group === 1, 起始章序号: group, 结束章序号: group,
    启用注入: true, 原文内容: '', 字数: 0, 原文摘要: '', 本段概括: '', 时间线起点: '', 时间线终点: '',
    开局已成立事实: [], 前段延续事实: [], 本段结束状态: group === 1 ? [] : ['没有眼泪的明天已完成'],
    给后续参考: [], 原著硬约束: [], 可提前铺垫: [], 登场角色: group === 1 ? ['安柏'] : ['温迪', '琴'],
    涉及地点: ['蒙德'], 涉及派系: ['西风骑士团'], 角色档案: [], 势力档案: [], 地图地点档案: [],
    关键事件: [], 时间线: [], 角色推进: [], 处理状态: '已完成', 运行状态: status, updatedAt: 1,
  };
}

function series(id: string, segments: 剧情编织分段[]): 剧情编织系列 {
  return {
    id, 标题: id, 作品名: '原神', 来源类型: 'canon', 来源图鉴条目ID: [], 章节列表: [], 分段列表: segments,
    每段章数: 1, 激活注入: true, 当前分段组号: 1, 当前阶段概括: '', 核心角色摘要: [], 核心角色: [],
    涉及地点索引: ['蒙德'], 涉及派系索引: ['西风骑士团'], createdAt: 1, updatedAt: 1,
  };
}

describe('canonDeviationService', () => {
  it('records a stable Mondstadt divergence at turn 7 without mutating inputs', () => {
    const track = createEmptyCanonTrack();
    const input = structuredClone(BASE_INPUT);
    const inputBefore = structuredClone(input);

    const next = recordCanonDeviation(track, input);

    expect(next).not.toBe(track);
    expect(next.deviations).toHaveLength(1);
    expect(next.deviations[0]).toMatchObject({
      id: 'canon-deviation:teyvat_prologue_mondstadt_act1:7',
      anchorId: 'teyvat_prologue_mondstadt_act1',
      turn: 7,
    });
    expect(track).toEqual(createEmptyCanonTrack());
    expect(input).toEqual(inputBefore);
  });

  it('merges the same semantic deviation deterministically and deduplicates all evidence fields', () => {
    const existing = recordCanonDeviation(createEmptyCanonTrack(), BASE_INPUT).deviations[0];
    const incoming: CanonDeviation = {
      ...existing,
      evidence: ['玩家保护了本应受伤的侦察骑士', '风魔龙没有按原路线攻城'],
      affectedCharacters: ['安柏', '温迪'],
      worldEffects: ['蒙德城门的战备路线改变', '西风骑士团提前集结'],
      blockedAnchorIds: ['teyvat_prologue_mondstadt_act2', 'teyvat_prologue_mondstadt_act3'],
      returnability: 'open' as const,
    };

    const merged = mergeCanonDeviation(existing, incoming);
    const repeated = mergeCanonDeviation(merged, incoming);

    expect(repeated).toEqual(merged);
    expect(merged.evidence).toEqual(['玩家保护了本应受伤的侦察骑士', '风魔龙没有按原路线攻城']);
    expect(merged.affectedCharacters).toEqual(['安柏', '温迪']);
    expect(merged.worldEffects).toEqual(['蒙德城门的战备路线改变', '西风骑士团提前集结']);
    expect(merged.blockedAnchorIds).toEqual(['teyvat_prologue_mondstadt_act2', 'teyvat_prologue_mondstadt_act3']);
    expect(existing).not.toBe(merged);
  });

  it('strictly rebuilds records, sanitizes text arrays, and drops unknown or nested values', () => {
    const normalized = normalizeCanonTrack({
      currentAnchor: 'teyvat_prologue_mondstadt_act1',
      notes: ['  玩家选择优先  ', { private: 'drop' }],
      unknownRoot: 'drop',
      deviations: [{
        ...BASE_INPUT,
        id: 'spoofed-id',
        evidence: ['  可见证据  ', '', { hidden: true }],
        affectedCharacters: [' 安柏 ', 3],
        worldEffects: [' 城门路线改变 '],
        blockedAnchorIds: ['teyvat_prologue_mondstadt_act2', 'hsr_jarilo_vi'],
        unknownNested: { chainOfThought: 'drop' },
      }],
    });

    expect(normalized).toEqual({
      currentAnchor: 'teyvat_prologue_mondstadt_act1',
      notes: ['玩家选择优先'],
      deviations: [{
        id: 'canon-deviation:teyvat_prologue_mondstadt_act1:7',
        anchorId: 'teyvat_prologue_mondstadt_act1',
        turn: 7,
        evidence: ['可见证据'],
        affectedCharacters: ['安柏'],
        worldEffects: ['城门路线改变'],
        blockedAnchorIds: ['teyvat_prologue_mondstadt_act2'],
        status: 'active',
        returnability: 'conditional',
      }],
    });
    expect(normalized).not.toHaveProperty('unknownRoot');
  });

  it.each([
    null,
    '',
    '  ',
    '7',
    false,
    [],
    [7],
    1.5,
    Number.POSITIVE_INFINITY,
  ])('rejects non-number or non-integer turn input %j', (turn) => {
    expect(normalizeCanonDeviation({ ...BASE_INPUT, turn })).toBeNull();
  });

  it.each(['none', 'conditional', 'open'] as const)('preserves and explains %s returnability', (returnability) => {
    const track = recordCanonDeviation(createEmptyCanonTrack(), { ...BASE_INPUT, returnability });
    const context = buildCanonContextWindow(track);
    expect(track.deviations[0].returnability).toBe(returnability);
    expect(context).toContain(returnability);
  });

  it('builds a player-fact context that forbids replay and names every blocked anchor', () => {
    const track = recordCanonDeviation(createEmptyCanonTrack(), {
      ...BASE_INPUT,
      blockedAnchorIds: ['teyvat_prologue_mondstadt_act2', 'teyvat_prologue_mondstadt_act3'],
    });
    const context = buildCanonContextWindow(track);
    expect(context).toContain('不得重演原事件结果');
    expect(context).toContain('teyvat_prologue_mondstadt_act2');
    expect(context).toContain('teyvat_prologue_mondstadt_act3');
    expect(context).not.toContain('chainOfThought');
  });

  it('normalizes and persists canon deviations through the unique Teyvat state', () => {
    const state = normalizeTeyvatGameState({
      universe: 'teyvat',
      原著轨道: {
        currentAnchor: 'teyvat_prologue_mondstadt_act1',
        deviations: [{ ...BASE_INPUT, id: 'untrusted', extra: 'drop' }],
        notes: [],
        extra: 'drop',
      },
    });
    expect(state.原著轨道.deviations[0].id).toBe('canon-deviation:teyvat_prologue_mondstadt_act1:7');
    expect(state.原著轨道.deviations[0]).not.toHaveProperty('extra');
    expect(state.原著轨道).not.toHaveProperty('extra');
  });

  it('injects canon context into the active story-weaving window', () => {
    const system: 剧情编织系统 = {
      当前系列ID: 'story_canon_teyvat_mondstadt_prologue_act1',
      系列列表: [series('story_canon_teyvat_mondstadt_prologue_act1', [segment('act1', 1, '当前')])],
    };
    const canonTrack = recordCanonDeviation(createEmptyCanonTrack(), BASE_INPUT);
    const injection = buildStoryWeavingInjection(system, { canonTrack, recentUserInput: '', recentAIResponse: '' });
    expect(injection).toContain('# 玩家已建立的原著偏离');
    expect(injection).toContain('不得重演原事件结果');
  });

  it('does not auto-advance into a blocked Teyvat canon anchor on keyword matches', () => {
    const currentSeries = series('story_canon_teyvat_mondstadt_prologue_act1', [segment('act1', 1, '当前')]);
    const blockedSeries = series('story_canon_teyvat_mondstadt_prologue_act2', [segment('act2', 1, '未开始')]);
    blockedSeries.核心角色 = ['温迪', '琴'];
    const storyWeaving: 剧情编织系统 = {
      当前系列ID: currentSeries.id,
      系列列表: [currentSeries, blockedSeries],
    };
    const canonTrack = recordCanonDeviation(createEmptyCanonTrack(), BASE_INPUT);
    const result = autoAlignCanonStoryProgress({
      storyWeaving,
      canonTrack,
      turnCount: 7,
      currentLocation: '蒙德城',
      userInput: '我们前往西风骑士团寻找温迪和琴',
      body: '没有眼泪的明天已经开始，温迪与琴都在蒙德。',
    });
    expect(result.system.当前系列ID).toBe(currentSeries.id);
    expect(result.progressed).toBe(false);
  });
});
