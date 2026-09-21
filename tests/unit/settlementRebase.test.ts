import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { rebaseSettlementState } from '@/utils/settlementRebase';

/**
 * A3 的行为契约：变量结算提交时不得丢掉玩家在等待期间的操作。
 * 用引用相等判定「谁改过」——本仓库所有写入都是整切片替换。
 */

const base = () => createEmptyTeyvatGameState();

describe('rebaseSettlementState', () => {
  it('takes the settlement result for slices nobody else touched', () => {
    const trueBase = base();
    const frozenBase = trueBase;
    const next = { ...trueBase, turnCount: trueBase.turnCount + 1, 世界: { ...trueBase.世界, 当前地点: '璃月港' } };

    const result = rebaseSettlementState({ trueBase, frozenBase, next, current: trueBase });

    expect(result.state.世界.当前地点).toBe('璃月港');
    expect(result.state.turnCount).toBe(trueBase.turnCount + 1);
    expect(result.preservedSlices).toEqual([]);
  });

  it('keeps the player edit when the settlement also changed that slice', () => {
    const trueBase = base();
    const frozenBase = trueBase;
    // 结算涨了背包，玩家在等待期间也改了背包（后写的是玩家）
    const next = { ...trueBase, 背包: { ...trueBase.背包, mora: 100 } };
    const playerInventory = { ...trueBase.背包, mora: 999 };
    const current = { ...trueBase, 背包: playerInventory };

    const result = rebaseSettlementState({ trueBase, frozenBase, next, current });

    expect(result.state.背包.mora).toBe(999);
    expect(result.preservedSlices).toEqual(['背包']);
  });

  it('keeps the player edit for a slice the settlement did not touch', () => {
    const trueBase = base();
    const frozenBase = trueBase;
    const next = { ...trueBase, 世界: { ...trueBase.世界, 当前地点: '璃月港' } };
    const current = { ...trueBase, NPC: [...trueBase.NPC, { id: 'npc_x', 姓名: '测试' } as never] };

    const result = rebaseSettlementState({ trueBase, frozenBase, next, current });

    expect(result.state.世界.当前地点).toBe('璃月港');
    expect(result.state.NPC).toHaveLength(1);
    expect(result.preservedSlices).toEqual([]);
  });

  it('still applies settlement changes for slices the pre-settlement overrides rebuilt', () => {
    // frozenBase 里 世界 是新对象（主流程本回合已覆盖），但玩家没碰过它 → 结算结果必须生效
    const trueBase = base();
    const frozenBase = { ...trueBase, 世界: { ...trueBase.世界, 当前地点: '蒙德城' } };
    const next = { ...frozenBase, 世界: { ...frozenBase.世界, 当前时间: '08:00' } };

    const result = rebaseSettlementState({ trueBase, frozenBase, next, current: trueBase });

    expect(result.state.世界.当前时间).toBe('08:00');
    expect(result.preservedSlices).toEqual([]);
  });

  it('never loses this settlement variable batch even when 叙事 conflicts', () => {
    const trueBase = base();
    const frozenBase = trueBase;
    const batch = { id: 'vbatch_1', turn: 1, timestamp: 1, source: 'main' as const, results: [] };
    const next = {
      ...trueBase,
      叙事: { ...trueBase.叙事, variableBatches: [...trueBase.叙事.variableBatches, batch] },
    };
    const current = { ...trueBase, 叙事: { ...trueBase.叙事, plotNodes: [{ id: 'node_1' } as never] } };

    const result = rebaseSettlementState({ trueBase, frozenBase, next, current });

    expect(result.preservedSlices).toEqual(['叙事']);
    expect(result.state.叙事.variableBatches.map((item) => item.id)).toContain('vbatch_1');
    expect(result.state.叙事.plotNodes).toHaveLength(1);
  });

  it('does not duplicate a batch that is already present', () => {
    const trueBase = base();
    const batch = { id: 'vbatch_1', turn: 1, timestamp: 1, source: 'main' as const, results: [] };
    const withBatch = { ...trueBase, 叙事: { ...trueBase.叙事, variableBatches: [batch] } };
    const frozenBase = trueBase;
    const next = withBatch;
    const current = { ...withBatch, 叙事: { ...withBatch.叙事, plotNodes: [{ id: 'n1' } as never] } };

    const result = rebaseSettlementState({ trueBase, frozenBase, next, current });

    expect(result.state.叙事.variableBatches.filter((item) => item.id === 'vbatch_1')).toHaveLength(1);
  });
});
