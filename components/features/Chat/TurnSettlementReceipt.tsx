import type { TurnSettlementReceiptModel } from '@/utils/turnSettlementReceipt';

const STATUS_LABELS = { success: '已生效', warning: '警告', failure: '未生效' } as const;

export function TurnSettlementReceipt({ receipt }: { receipt: TurnSettlementReceiptModel }) {
  return (
    <details
      className="mx-1 my-2 min-w-0 px-3 py-2 text-xs"
      style={{
        color: 'rgba(var(--tj-text-primary),0.92)',
        background: 'rgba(var(--tj-bg-primary),0.42)',
        boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border),0.45)',
      }}
    >
      <summary className="cursor-pointer select-none break-words font-serif leading-5" style={{ color: 'rgba(var(--tj-text-primary),0.95)' }}>
        本回合变化 · {receipt.summary}
      </summary>
      {receipt.items.length > 0 ? (
        <ol className="mt-2 grid gap-1.5 border-t pt-2" style={{ borderColor: 'rgba(var(--tj-border),0.36)' }}>
          {receipt.items.map((item, index) => (
            <li key={`${index}-${item.status}`} className="flex min-w-0 flex-wrap gap-x-2 break-words leading-5">
              <span className="shrink-0" style={{ color: item.status === 'failure' ? 'rgba(var(--tj-danger),0.94)' : 'rgba(var(--tj-text-secondary),0.94)' }}>
                {STATUS_LABELS[item.status]}
              </span>
              <span className="min-w-0 flex-1 break-words">{item.label}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 border-t pt-2 leading-5" style={{ borderColor: 'rgba(var(--tj-border),0.36)' }}>本回合没有需要展示的结算条目。</p>
      )}
    </details>
  );
}
