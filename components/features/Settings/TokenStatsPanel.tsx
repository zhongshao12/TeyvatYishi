import { useMemo } from 'react';
import type { 聊天消息 } from '@/models/chat';
import { 是否超预算, 拆分聊天Token用量, 累计Token用量 } from '@/utils/tokenUsageStats';

interface TokenStatsPanelProps {
  chatHistory: 聊天消息[];
  budgetTokens?: number;
}

const smallClip = 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)';

export function TokenStatsPanel({ chatHistory, budgetTokens }: TokenStatsPanelProps) {
  const totals = useMemo(() => 累计Token用量(chatHistory), [chatHistory]);
  const bySystem = useMemo(() => 拆分聊天Token用量(chatHistory), [chatHistory]);
  const overBudget = 是否超预算(totals, budgetTokens);
  const systems = Object.keys(bySystem).sort();
  const systemLabels: Record<string, string> = {
    main_story: "主剧情",
    variable: "变量模型",
    steambird: "蒸汽鸟报推演",
    courier: "手机消息",
    quest: "剧情任务",
  };
  return (
    <div className="space-y-3">
      <div className="px-3 py-2 text-xs leading-relaxed" style={{ color: overBudget ? "rgba(var(--tj-accent-secondary),0.95)" : "rgba(var(--tj-text-secondary),0.78)", boxShadow: `inset 0 0 0 1px ${overBudget ? "rgba(var(--tj-accent-secondary),0.4)" : "rgba(var(--tj-accent-primary),0.16)"}`, clipPath: smallClip }}>
        会话累计 {totals.totalTokens} token（输入 {totals.inputTokens} / 输出 {totals.outputTokens}）
        {overBudget ? "，已超出预算，请注意用量。" : "。"}
      </div>
      <table className="w-full text-xs" style={{ color: "rgba(var(--tj-text-secondary),0.85)" }}>
        <thead>
          <tr className="text-left" style={{ color: "rgba(var(--tj-text-secondary),0.6)" }}>
            <th className="px-2 py-1">系统</th><th className="px-2 py-1">输入</th><th className="px-2 py-1">输出</th><th className="px-2 py-1">合计</th>
          </tr>
        </thead>
        <tbody>
          {systems.map((system) => {
            const entry = bySystem[system];
            return (
              <tr key={system} style={{ boxShadow: "inset 0 -1px 0 rgba(var(--tj-border),0.35)" }}>
                <td className="px-2 py-1">{systemLabels[system] ?? system}</td>
                <td className="px-2 py-1">{entry.inputTokens}</td>
                <td className="px-2 py-1">{entry.outputTokens}</td>
                <td className="px-2 py-1">{entry.totalTokens}</td>
              </tr>
            );
          })}
          {systems.length === 0 && <tr><td className="px-2 py-3" colSpan={4}>暂无 Token 统计。发送回合后自动记录主剧情用量。</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
