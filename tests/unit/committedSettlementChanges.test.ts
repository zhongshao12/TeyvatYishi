import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import type { TeyvatNpcRecord } from '@/models/teyvat/character';
import { projectCommittedSettlementChanges } from '@/utils/committedSettlementChanges';

describe('committed settlement changes', () => {
  it('projects only actual item, affinity, quest, and time state differences', () => {
    const before = createEmptyTeyvatGameState();
    before.背包.items = [{ id: 'apple-1', name: '日落果', category: 'food', description: '食物', quantity: 2, rarity: 1, obtainedAtTurn: 1 }];
    before.NPC = [{ id: 'amber', 姓名: '安柏', affinity: 10 } as TeyvatNpcRecord];
    before.任务.active = [{ id: 'quest-1', title: '去见安柏', description: '', source: 'side', status: 'active', objectives: [], rewards: [], createdAtTurn: 1, updatedAt: 1 }];
    before.世界.当前日期 = '2026-09-27';
    before.世界.当前时间 = '10:00';
    const after = {
      ...before,
      背包: { ...before.背包, items: [{ ...before.背包.items[0]!, quantity: 1 }] },
      NPC: [{ ...before.NPC[0]!, affinity: 15 }],
      任务: { ...before.任务, active: [], completed: [{ ...before.任务.active[0]!, status: 'completed' as const }] },
      世界: { ...before.世界, 当前时间: '18:00' },
    };
    expect(projectCommittedSettlementChanges(before, after).changes).toEqual([
      { kind: 'item', id: 'apple-1', name: '日落果', before: 2, after: 1 },
      { kind: 'affinity', id: 'amber', name: '安柏', before: 10, after: 15 },
      { kind: 'quest', id: 'quest-1', title: '去见安柏', before: 'active', after: 'completed' },
      { kind: 'time', beforeDate: '2026-09-27', beforeTime: '10:00', afterDate: '2026-09-27', afterTime: '18:00' },
    ]);
  });

  it('ignores uncommitted prose-only differences', () => {
    const before = createEmptyTeyvatGameState();
    expect(projectCommittedSettlementChanges(before, before).changes).toEqual([]);
  });
});
