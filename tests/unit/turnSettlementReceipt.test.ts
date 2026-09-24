import { describe, expect, it } from 'vitest';
import type { 聊天消息 } from '@/models/chat';
import type { 变量命令批次, 变量命令结果 } from '@/models/variableCommand';
import { buildTurnSettlementReceipt } from '@/utils/turnSettlementReceipt';

const assistant = (gameTime?: string): 聊天消息 => ({
  id: 'assistant-3', role: 'assistant', content: '正文', timestamp: 100, gameTime,
});

const result = (overrides: Partial<变量命令结果> = {}): 变量命令结果 => ({
  command: { action: 'add', key: '背包.物品[0].数量', value: 2 },
  ok: true,
  ...overrides,
});

const batch = (overrides: Partial<变量命令批次> = {}): 变量命令批次 => ({
  id: 'batch-3', turn: 3, timestamp: 101, source: 'main', results: [result()],
  ...overrides,
});

describe('buildTurnSettlementReceipt', () => {
  it('projects ordered item changes and diagnostics from all matching formal batches', () => {
    const receipt = buildTurnSettlementReceipt(assistant('3'), [
      batch({ results: [
        result(),
        result({ command: { action: 'sub', key: '背包.物品[0].数量', value: 1 } }),
        result({ command: { action: 'set', key: '(事实忽略)', value: null }, ok: false, kind: 'warning', reason: '物品归属不明' }),
      ] }),
      batch({ id: 'calibration', source: 'calibration', results: [
        result({ command: { action: 'delete', key: '任务.事项[0]', value: null }, ok: false, kind: 'rejected', reason: 'INVALID_REQUIRED_FIELD' }),
      ] }),
    ]);
    expect(receipt?.turn).toBe(3);
    expect(receipt?.items.map((item) => item.status)).toEqual(['success', 'success', 'warning', 'failure']);
    expect(receipt?.items[0]?.label).toContain('背包');
    expect(receipt?.items[0]?.label).toContain('2');
    expect(receipt?.items[1]?.label).toContain('减少');
    expect(receipt?.items[2]?.label).toContain('物品归属不明');
    expect(JSON.stringify(receipt)).not.toContain('INVALID_REQUIRED_FIELD');
  });

  it('does not invent a receipt for user, missing, malformed, or mismatched turns', () => {
    expect(buildTurnSettlementReceipt({ ...assistant('3'), role: 'user' }, [batch()])).toBeNull();
    expect(buildTurnSettlementReceipt(assistant(), [batch()])).toBeNull();
    expect(buildTurnSettlementReceipt(assistant('3.0'), [batch()])).toBeNull();
    expect(buildTurnSettlementReceipt(assistant('-3'), [batch()])).toBeNull();
    expect(buildTurnSettlementReceipt(assistant('9007199254740992'), [batch()])).toBeNull();
    expect(buildTurnSettlementReceipt(assistant('4'), [batch()])).toBeNull();
    expect(buildTurnSettlementReceipt(assistant('3'), [])).toBeNull();
  });

  it('does not repeat duplicate batch IDs or disclose raw model content, values, or secrets', () => {
    const receipt = buildTurnSettlementReceipt(assistant('3'), [
      batch({ rawText: 'SECRET_API_KEY', report: 'SECRET_REPORT', results: [
        result({ command: { action: 'set', key: 'NPC[0].秘密', value: 'PRIVATE_VALUE' }, evidence: 'PRIVATE_EVIDENCE' }),
        result({ ok: false, kind: 'error', reason: 'api-key=SECRET_REASON' }),
      ] }),
      batch({ results: [result()] }),
    ]);
    expect(receipt?.items).toHaveLength(2);
    for (const secret of ['SECRET_API_KEY', 'SECRET_REPORT', 'PRIVATE_VALUE', 'PRIVATE_EVIDENCE', 'SECRET_REASON']) {
      expect(JSON.stringify(receipt)).not.toContain(secret);
    }
  });

  it('shows an empty formal result and compressed history without fabricating changes', () => {
    expect(buildTurnSettlementReceipt(assistant('3'), [batch({ results: [] })])?.summary).toBe('本回合无变量变化');
    const compressed = buildTurnSettlementReceipt(assistant('3'), [batch({
      results: [], retentionSummary: { totalResults: 7, succeededResults: 6, diagnosticResults: 1, omittedDiagnosticResults: 1 },
    })]);
    expect(compressed?.items).toEqual([{ status: 'warning', label: '旧结算记录已压缩' }]);
  });
});
