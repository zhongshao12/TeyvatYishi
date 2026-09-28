import { describe, expect, it } from 'vitest';
import type { 变量命令结果, 变量命令批次 } from '@/models/variableCommand';
import { 提取好感变化事件 } from '@/utils/relationshipGraph';
import { fromLegacyVariableBatches, toLegacyVariableBatches } from '@/hooks/useGameState';

/**
 * 「最近好感变化」面板的数据源。
 *
 * 这里必须用**真实结算产生的 key 形态**做用例：
 * 现行回执写的是 `NPC.[id=npc_amber].affinity`（英文 affinity，见 variableSettlementWorkflow 组装 key 的那一行），
 * 旧实现却按中文字段名「好感度」筛选，于是面板永远空 —— 门禁只断言了函数名，没断言行为。
 */

const result = (
  action: 变量命令结果['command']['action'],
  key: string,
  value: unknown,
  extra: Partial<变量命令结果> = {},
): 变量命令结果 => ({ command: { action, key, value }, ok: true, kind: 'command', ...extra });

const batch = (turn: number, results: 变量命令结果[]): 变量命令批次 => ({
  id: `b${turn}`, turn, timestamp: turn, source: 'main', results,
});

describe('提取好感变化事件', () => {
  it('recent_events_use_committed_delta', () => {
    const events = 提取好感变化事件([
      batch(2, [result('add', 'NPC.[id=npc_amber].affinity', 5), result('sub', 'NPC.[id=npc_lisa].affinity', 3)]),
      batch(3, [result('set', 'NPC.[id=npc_amber].affinity', 40), result('add', 'NPC.[id=npc_lisa].affinity', 99, { ok: false, kind: 'rejected' })]),
    ]);
    expect(events.map(({ action, delta, value }) => ({ action, delta, value }))).toEqual([
      { action: 'add', delta: 5, value: null },
      { action: 'sub', delta: -3, value: null },
      { action: 'set', delta: null, value: 40 },
    ]);
  });
  it('reads the live domain key (affinity), not only the legacy Chinese field', () => {
    const events = 提取好感变化事件([batch(7, [result('add', 'NPC.[id=npc_amber].affinity', 5)])]);

    expect(events).toEqual([expect.objectContaining({
      npcId: 'npc_amber', turn: 7, action: 'add', delta: 5, value: null,
    })]);
  });

  it('still reads legacy batches that were persisted with the Chinese field name', () => {
    const events = 提取好感变化事件([batch(3, [result('add', 'NPC.安柏.好感度', 3)])]);

    expect(events).toEqual([expect.objectContaining({ npcId: '安柏', turn: 3, delta: 3, action: 'add' })]);
  });

  it('reports a set command as an absolute value instead of a fake delta', () => {
    const events = 提取好感变化事件([batch(4, [result('set', 'NPC.[id=npc_amber].affinity', 40)])]);

    expect(events).toEqual([expect.objectContaining({ action: 'set', delta: null, value: 40 })]);
  });

  it('turns sub into a negative delta', () => {
    const events = 提取好感变化事件([batch(5, [result('sub', 'NPC.[id=npc_kaeya].affinity', 4)])]);

    expect(events[0]).toMatchObject({ npcId: 'npc_kaeya', delta: -4 });
  });

  it('resolves the display name from the current roster and falls back to the id', () => {
    const batches = [batch(6, [
      result('add', 'NPC.[id=npc_amber].affinity', 5),
      result('add', 'NPC.[id=npc_unknown].affinity', 2),
    ])];
    const events = 提取好感变化事件(batches, { resolveNpcName: (id) => (id === 'npc_amber' ? '安柏' : undefined) });

    expect(events.map((event) => event.npcName)).toEqual(['安柏', 'npc_unknown']);
  });

  it('ignores non-affinity commands and failed results', () => {
    const events = 提取好感变化事件([batch(8, [
      result('set', 'NPC.[id=npc_amber].lastSeenTurn', 8),
      result('sub', '背包.items[id=item_food_egg].quantity', 1),
      result('push', '旅行者.capabilities', '风之翼驾驶'),
      result('add', 'NPC.[id=npc_amber].affinity', 5, { ok: false, kind: 'rejected', reason: 'INVALID_NUMERIC_RESULT' }),
      result('add', 'NPC.[id=npc_amber].relationshipLedger.mustRemember', 'x'),
    ])]);

    expect(events).toEqual([]);
  });

  it('keeps chronology across batches', () => {
    const events = 提取好感变化事件([
      batch(9, [result('add', 'NPC.[id=npc_amber].affinity', 1)]),
      batch(2, [result('add', 'NPC.[id=npc_amber].affinity', 2)]),
    ]);

    expect(events.map((event) => event.turn)).toEqual([2, 9]);
  });

  it('carries the settlement reason through the save round trip', () => {
    const legacy = [batch(4, [result('add', 'NPC.[id=npc_amber].affinity', 5, { evidence: '每日同行固定好感度' })])];
    const roundTripped = toLegacyVariableBatches(fromLegacyVariableBatches(legacy));

    expect(提取好感变化事件(roundTripped)[0]?.reason).toBe('每日同行固定好感度');
  });
});
