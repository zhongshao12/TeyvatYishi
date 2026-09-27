import type { 聊天消息 } from '@/models/chat';
import type { CommittedSettlementChange, 变量命令动作, 变量命令批次, 变量命令结果 } from '@/models/variableCommand';

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
  图鉴: '图鉴', 手机: '手机', NPC: '同伴', 蒸汽鸟报: '蒸汽鸟报', 剧情: '剧情', 任务: '任务',
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

  const root = /^(旅人|背包|世界树|世界|记忆|图鉴|手机|NPC|蒸汽鸟报|剧情|任务)(?=\.|\[|$)/u.exec(result.command.key)?.[1] ?? '';
  const domain = DOMAIN_LABELS[root] ?? '状态';
  const action = ACTION_LABELS[result.command.action] ?? '更新';
  const value = result.command.value;
  const amount = typeof value === 'number' && Number.isFinite(value) && String(value).length <= 12
    ? ` ${value}`
    : '';
  return { status: 'success', label: `${domain}${action}${amount}` };
}

const QUEST_STATUS_LABELS = {
  absent: '未登记', not_started: '未开始', active: '进行中',
  completed: '已完成', failed: '失败', abandoned: '已放弃',
} as const;

function committedChangeToItem(change: CommittedSettlementChange): TurnSettlementReceiptItem {
  switch (change.kind) {
    case 'item': return { status: 'success', label: `${change.name} ${change.before} → ${change.after}` };
    case 'affinity': return { status: 'success', label: `${change.name}好感度 ${change.before} → ${change.after}` };
    case 'quest': return { status: 'success', label: `${change.title}：${QUEST_STATUS_LABELS[change.before]} → ${QUEST_STATUS_LABELS[change.after]}` };
    case 'time': return { status: 'success', label: `时间：${change.beforeDate} ${change.beforeTime} → ${change.afterDate} ${change.afterTime}` };
  }
}

function hasSpecificProjection(key: string): boolean {
  return /^(背包|NPC|任务)(?=\.|\[|$)/u.test(key) || /^世界\.(当前日期|当前时间)(?=\.|\[|$)/u.test(key);
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

  const items = matching.flatMap((batch): TurnSettlementReceiptItem[] => {
    if (batch.retentionSummary) return [{ status: 'warning', label: '旧结算记录已压缩' }];
    if (batch.committedChanges === undefined) return batch.results.map(resultToReceiptItem);
    const concrete = batch.committedChanges.map(committedChangeToItem);
    const remaining = batch.results
      .filter((result) => !result.ok || !hasSpecificProjection(result.command.key))
      .map(resultToReceiptItem);
    const omitted = batch.omittedCommittedChanges && batch.omittedCommittedChanges > 0
      ? [{ status: 'warning' as const, label: `另有 ${batch.omittedCommittedChanges} 项已提交变化未逐条展示` }]
      : [];
    return [...concrete, ...remaining, ...omitted];
  });
  const success = items.filter((item) => item.status === 'success').length;
  const warnings = items.filter((item) => item.status === 'warning').length;
  const failures = items.filter((item) => item.status === 'failure').length;
  return {
    turn,
    items,
    summary: items.length ? `${success} 项变化，${warnings} 条警告，${failures} 项失败` : '本回合无变量变化',
  };
}
