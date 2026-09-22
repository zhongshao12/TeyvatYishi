import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '@/models/teyvat/state';
import { rebaseSettlementState } from '@/utils/settlementRebase';

/**
 * A3 的行为契约：变量结算提交时不得丢掉玩家在等待期间的操作，
 * 也不得把**没被碰过**的切片判成冲突（否则结算结果整体被丢弃）。
 *
 * 判定基准是「结算开始那一刻的活体根」(`ancestor`)：
 *  - `ancestor` 与 `current` 同一血缘（都取自活体 React 状态），引用可比较；
 *  - 归一化产的快照（`baseGameSnapshot`）每个切片都是新对象，不能当基准 —— 见 utils/settlementRebase.ts。
 */

const base = () => createEmptyTeyvatGameState();

describe('rebaseSettlementState', () => {
  it('takes the settlement result for slices nobody touched during the wait', () => {
    const ancestor = base();
    const next = { ...ancestor, turnCount: ancestor.turnCount + 1, 世界: { ...ancestor.世界, 当前地点: '璃月港' } };

    const result = rebaseSettlementState({ ancestor, next, current: ancestor });

    expect(result.state.世界.当前地点).toBe('璃月港');
    expect(result.state.turnCount).toBe(ancestor.turnCount + 1);
    expect(result.preservedSlices).toEqual([]);
  });

  it('keeps the player edit when the player changed that slice while the settlement was running', () => {
    const ancestor = base();
    // 结算涨了背包，玩家在等待期间也改了背包（后写的是玩家）
    const next = { ...ancestor, 背包: { ...ancestor.背包, mora: 100 } };
    const playerInventory = { ...ancestor.背包, mora: 999 };
    const current = { ...ancestor, 背包: playerInventory };

    const result = rebaseSettlementState({ ancestor, next, current });

    expect(result.state.背包.mora).toBe(999);
    expect(result.preservedSlices).toEqual(['背包']);
  });

  it('keeps the player edit for a slice the settlement did not touch, and reports the concurrent write', () => {
    const ancestor = base();
    const next = { ...ancestor, 世界: { ...ancestor.世界, 当前地点: '璃月港' } };
    const current = { ...ancestor, NPC: [...ancestor.NPC, { id: 'npc_x', 姓名: '测试' } as never] };

    const result = rebaseSettlementState({ ancestor, next, current });

    expect(result.state.世界.当前地点).toBe('璃月港');
    expect(result.state.NPC).toHaveLength(1);
    // NPC 在等待期间被写过 → 以活体值为准并如实上报（不能静默覆盖）
    expect(result.preservedSlices).toEqual(['NPC']);
  });

  it('never lets a concurrent conversation write drop this turn\'s assistant message', () => {
    // 玩家在等待期间给旧消息加了书签（setChatHistory → 对话 换引用），
    // 但本回合的 assistant 消息只存在于结算结果里 —— 必须保住它，同时保住书签。
    const ancestor = base();
    const userEntry = { id: 'user-1', role: 'user' as const, content: '出发', timestamp: 1 };
    const assistantEntry = { id: 'assistant-1', role: 'assistant' as const, content: '风起了。', timestamp: 2 };
    const withUser = { ...ancestor, 对话: { entries: [userEntry] } };
    const current = { ...withUser, 对话: { entries: [{ ...userEntry, bookmarked: true }] } };
    const next = { ...withUser, 对话: { entries: [userEntry, assistantEntry] } };

    const result = rebaseSettlementState({ ancestor, next, current });

    expect(result.state.对话.entries.map((entry) => entry.id)).toEqual(['user-1', 'assistant-1']);
    expect(result.state.对话.entries[0]?.bookmarked).toBe(true);
    expect(result.preservedSlices).toEqual([]);
  });

  it('applies every settlement slice when the live root was rebuilt by the main flow before the settlement', () => {
    // 回归（本轮用户报告的「回合数卡住」根因之一）：
    // 主流程在本回合重建过的切片（世界/旅人/记忆/手机…）与归一化快照必然不是同一引用。
    // 若拿归一化快照（或渲染旧根）当「玩家改过」的基准，这些切片会被整体判成冲突，
    // 于是结算结果（含 turnCount）被全部丢弃 —— 表现就是回合数不再增长。
    const base0 = base();
    // 结算开始时活体根里的 世界 已经是主流程本回合重建过的对象
    const rebuiltWorld = normalizeTeyvatGameState({ ...base0, 世界: { ...base0.世界, 当前地点: '蒙德城' } }).世界;
    const ancestor = { ...base0, 世界: rebuiltWorld };
    // 本回合 user 消息落地（主流程自己写的，不算冲突来源以外的变化）
    const current = {
      ...ancestor,
      对话: { entries: [...ancestor.对话.entries, { id: 'user-1', role: 'user' as const, content: '出发', timestamp: 1 }] },
    };
    const next = { ...ancestor, turnCount: ancestor.turnCount + 1, 世界: { ...rebuiltWorld, 当前时间: '08:00' } };

    const result = rebaseSettlementState({ ancestor, next, current });

    // 对话走按 id 合并：既有条目取活体版本，本回合新增条目来自结算结果，因此不算「被顶掉」的冲突。
    expect(result.preservedSlices).toEqual([]);
    expect(result.state.turnCount).toBe(ancestor.turnCount + 1);
    expect(result.state.世界.当前时间).toBe('08:00');
  });

  it('never loses this settlement variable batch even when 叙事 conflicts', () => {
    const ancestor = base();
    const batch = { id: 'vbatch_1', turn: 1, timestamp: 1, source: 'main' as const, results: [] };
    const next = {
      ...ancestor,
      叙事: { ...ancestor.叙事, variableBatches: [...ancestor.叙事.variableBatches, batch] },
    };
    const current = { ...ancestor, 叙事: { ...ancestor.叙事, plotNodes: [{ id: 'node_1' } as never] } };

    const result = rebaseSettlementState({ ancestor, next, current });

    expect(result.preservedSlices).toEqual(['叙事']);
    expect(result.state.叙事.variableBatches.map((item) => item.id)).toContain('vbatch_1');
    expect(result.state.叙事.plotNodes).toHaveLength(1);
  });

  it('does not duplicate a batch that is already present', () => {
    const ancestor = base();
    const batch = { id: 'vbatch_1', turn: 1, timestamp: 1, source: 'main' as const, results: [] };
    const withBatch = { ...ancestor, 叙事: { ...ancestor.叙事, variableBatches: [batch] } };
    const next = withBatch;
    const current = { ...withBatch, 叙事: { ...withBatch.叙事, plotNodes: [{ id: 'n1' } as never] } };

    const result = rebaseSettlementState({ ancestor, next, current });

    expect(result.state.叙事.variableBatches.filter((item) => item.id === 'vbatch_1')).toHaveLength(1);
  });
});
