import type { 聊天消息, 回合Token消耗 } from '@/models/chat';

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

function emptyTotals(): TokenTotals {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

/** 汇总聊天记录中全部回合的 token 用量（仅统计带 tokenUsage 的消息）。 */
export function 累计Token用量(messages: 聊天消息[]): TokenTotals {
  const totals = emptyTotals();
  for (const message of Array.isArray(messages) ? messages : []) {
    const usage = message.tokenUsage;
    if (!usage) continue;
    totals.inputTokens += Math.max(0, Number(usage.inputTokens) || 0);
    totals.outputTokens += Math.max(0, Number(usage.outputTokens) || 0);
    totals.totalTokens += Math.max(0, Number(usage.totalTokens) || 0);
  }
  return totals;
}

/** 按系统拆分用量（usage.system，缺省归入 main_story）。 */
export function 拆分Token用量(usages: 回合Token消耗[]): Record<string, TokenTotals> {
  const result: Record<string, TokenTotals> = {};
  for (const usage of Array.isArray(usages) ? usages : []) {
    const system = usage.system || "main_story";
    const entry = result[system] ?? emptyTotals();
    entry.inputTokens += Math.max(0, Number(usage.inputTokens) || 0);
    entry.outputTokens += Math.max(0, Number(usage.outputTokens) || 0);
    entry.totalTokens += Math.max(0, Number(usage.totalTokens) || 0);
    result[system] = entry;
  }
  return result;
}

/** 从聊天记录按系统拆分。 */
export function 拆分聊天Token用量(messages: 聊天消息[]): Record<string, TokenTotals> {
  const usages: 回合Token消耗[] = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message.tokenUsage) usages.push(message.tokenUsage);
  }
  return 拆分Token用量(usages);
}

export function 是否超预算(totals: TokenTotals, budgetTokens?: number): boolean {
  return Boolean(budgetTokens && budgetTokens > 0 && totals.totalTokens > budgetTokens);
}
