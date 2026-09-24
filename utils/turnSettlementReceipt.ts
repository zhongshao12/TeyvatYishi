import type { 聊天消息 } from '@/models/chat';
import type { 变量命令动作, 变量命令批次, 变量命令结果 } from '@/models/variableCommand';

export interface TurnSettlementReceiptItem {
  status: 'success' | 'warning' | 'failure';
  label: string;
}

export interface TurnSettlementReceiptModel {
  turn: number;
  summary: string;
  items: TurnSettlementReceiptItem[];
}

const DOMAIN_LABELS: Record<string, string> = {
  旅人: '旅人', 背包: '背包', 世界: '世界与时间', 记忆: '记忆', 世界树: '世界树',
  图鉴: '图鉴', 手机: '手机', NPC: '同伴', 蒸汽鸟报: '蒸汽鸟报', 剧情: '剧情',
};
const ACTION_LABELS: Record<变量命令动作, string> = {
  set: '更新', add: '增加', sub: '减少', push: '新增', delete: '移除',
};
const SAFE_REASONS = new Set([
  '物品归属不明', '物品不存在', '物品数量不足', '路径未登记', '类型不匹配',
  '事实证据不足', '时间回退已忽略', '角色不存在',
]);

function resultToReceiptItem(result: 变量命令结果): TurnSettlementReceiptItem {
  if (!result.ok) {
    return {
      status: result.kind === 'warning' ? 'warning' : 'failure',
      label: result.reason && SAFE_REASONS.has(result.reason) ? result.reason : '结算未生效，查看变量记录',
    };
  }

  const root = /^(旅人|背包|世界树|世界|记忆|图鉴|手机|NPC|蒸汽鸟报|剧情)(?=\.|\[|$)/u.exec(result.command.key)?.[1] ?? '';
  const domain = DOMAIN_LABELS[root] ?? '状态';
  const action = ACTION_LABELS[result.command.action] ?? '更新';
  const value = result.command.value;
  const amount = typeof value === 'number' && Number.isFinite(value) && String(value).length <= 12
    ? ` ${value}`
    : '';
  return { status: 'success', label: `${domain}${action}${amount}` };
}

/** Projects only persisted, same-turn variable results; never exposes raw model output. */
export function buildTurnSettlementReceipt(
  message: 聊天消息,
  batches: readonly 变量命令批次[],
): TurnSettlementReceiptModel | null {
  if (message.role !== 'assistant' || !/^\d+$/u.test(message.gameTime ?? '')) return null;
  const turn = Number(message.gameTime);
  if (!Number.isSafeInteger(turn)) return null;

  const seen = new Set<string>();
  const matching = batches.filter((batch) => {
    if (batch.turn !== turn || seen.has(batch.id)) return false;
    seen.add(batch.id);
    return true;
  });
  if (matching.length === 0) return null;

  const items = matching.flatMap((batch): TurnSettlementReceiptItem[] =>
    batch.retentionSummary
      ? [{ status: 'warning', label: '旧结算记录已压缩' }]
      : batch.results.map(resultToReceiptItem),
  );
  const success = items.filter((item) => item.status === 'success').length;
  const warnings = items.filter((item) => item.status === 'warning').length;
  const failures = items.filter((item) => item.status === 'failure').length;
  return {
    turn,
    items,
    summary: items.length ? `${success} 项变化，${warnings} 条警告，${failures} 项失败` : '本回合无变量变化',
  };
}
