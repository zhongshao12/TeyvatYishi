import { CLIP_PANEL, CLIP_SMALL, insetRing } from '@/styles/clipPaths';
import type { WorkflowRecoveryJournal } from '@/utils/workflowRecoveryModel';

interface RecoveryBannerProps {
  journal: WorkflowRecoveryJournal | null;
  resumable: boolean;
  onResume: () => void;
  onDismiss: () => void;
}




export function RecoveryBanner({ journal, resumable, onResume, onDismiss }: RecoveryBannerProps) {
  if (!journal) return null;
  return (
    <div className="fixed left-1/2 top-4 z-[120] w-[min(92vw,560px)] -translate-x-1/2" role="status">
      <div
        className="px-4 py-3"
        style={{
          background: 'rgba(var(--tj-surface-strong),0.96)',
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary),0.45), 0 12px 32px rgba(0,0,0,0.35)',
          clipPath: CLIP_PANEL,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-serif text-sm font-bold tracking-[0.14em]" style={{ color: 'rgba(var(--tj-text-primary))' }}>
              检测到第 {journal.turnAtStart} 回合未完成
            </div>
            <div className="mt-1 text-xs leading-relaxed" style={{ color: 'rgba(var(--tj-text-secondary))' }}>
              恢复阶段：{journal.phase}
              {resumable ? '。正文已生成，可安全恢复后续结算。' : '。正文尚未生成，请重新发送输入。'}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {resumable && (
              <button
                type="button"
                onClick={onResume}
                className="px-3 py-1.5 text-xs"
                style={{
                  color: 'rgba(var(--tj-text-primary))',
                  background: 'rgba(var(--tj-accent-primary),0.18)',
                  boxShadow: insetRing(0.5),
                  clipPath: CLIP_SMALL,
                }}
              >
                恢复上一回合
              </button>
            )}
            <button
              type="button"
              onClick={onDismiss}
              className="px-3 py-1.5 text-xs"
              style={{
                color: 'rgba(var(--tj-text-secondary))',
                boxShadow: 'inset 0 0 0 1px rgba(var(--tj-border),0.6)',
                clipPath: CLIP_SMALL,
              }}
            >
              忽略
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
