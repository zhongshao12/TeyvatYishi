import { CLIP_SMALL } from '@/styles/clipPaths';
import type { TokenTotals } from '@/utils/tokenUsageStats';

interface TokenMeterProps {
  turnTokens?: TokenTotals;
  sessionTotal: TokenTotals;
  budgetTokens?: number;
}



export function TokenMeter({ turnTokens, sessionTotal, budgetTokens }: TokenMeterProps) {
  const overBudget = Boolean(budgetTokens && budgetTokens > 0 && sessionTotal.totalTokens > budgetTokens);
  const text = turnTokens
    ? `本回合 ${turnTokens.totalTokens} token（入 ${turnTokens.inputTokens} / 出 ${turnTokens.outputTokens}）· 累计 ${sessionTotal.totalTokens}`
    : `累计 ${sessionTotal.totalTokens} token`;
  return (
    <div className="flex justify-end px-2 pb-1">
      <span className="px-2 py-0.5 text-[10px]" style={{
        color: overBudget ? "rgba(var(--tj-accent-secondary),0.95)" : "rgba(var(--tj-text-secondary),0.68)",
        background: overBudget ? "rgba(var(--tj-accent-secondary),0.09)" : "rgba(var(--tj-bg-primary),0.5)",
        boxShadow: `inset 0 0 0 1px ${overBudget ? "rgba(var(--tj-accent-secondary),0.35)" : "rgba(var(--tj-border),0.45)"}`,
        clipPath: CLIP_SMALL,
      }}>
        {text}{overBudget ? " · 超出预算" : ""}
      </span>
    </div>
  );
}
