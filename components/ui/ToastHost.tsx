import { useSyncExternalStore } from 'react';
import { dismissToast, getToasts, subscribeToasts, type ToastItem } from '@/utils/toastStore';

// 应用内通知角标：右下角手账纸条式 toast，覆盖所有视图与弹窗。
const KIND_STYLE: Record<ToastItem['kind'], { stroke: string; glyph: string; glyphColor: string }> = {
  info: { stroke: 'rgba(var(--tj-accent-primary), 0.55)', glyph: '❦', glyphColor: 'rgba(var(--tj-accent-primary), 0.9)' },
  success: { stroke: 'rgba(var(--tj-ui-success), 0.6)', glyph: '✓', glyphColor: 'rgba(var(--tj-ui-success), 0.95)' },
  error: { stroke: 'rgba(var(--tj-danger), 0.65)', glyph: '！', glyphColor: 'rgba(var(--tj-danger), 0.95)' },
};

export function ToastHost() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[120] flex w-[min(92vw, 340px)] flex-col gap-2">
      {toasts.map((toast) => {
        const style = KIND_STYLE[toast.kind];
        return (
          <div
            key={toast.id}
            role="status"
            className="journal-toast-card pointer-events-auto animate-slide-up px-3 py-2.5"
            style={{
              background: 'rgba(var(--tj-surface-strong), 0.96)',
              borderLeft: `2px solid ${style.stroke}`,
              boxShadow: `inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.12), 0 10px 26px rgba(var(--tj-shadow), 0.45)`,
              clipPath: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)',
            }}
          >
            <div className="flex items-start gap-2">
              <span aria-hidden className="mt-[1px] font-serif text-[13px] leading-5" style={{ color: style.glyphColor }}>
                {style.glyph}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-serif text-[13px] leading-5 tracking-wide" style={{ color: 'rgba(var(--tj-text-primary), 0.96)' }}>
                  {toast.title}
                </div>
                {toast.detail && (
                  <div className="mt-0.5 line-clamp-3 text-[11px] leading-5" style={{ color: 'rgba(var(--tj-text-secondary), 0.92)' }}>
                    {toast.detail}
                  </div>
                )}
                {toast.action && (
                  <button
                    type="button"
                    onClick={() => {
                      dismissToast(toast.id);
                      toast.action?.run();
                    }}
                    className="mt-1.5 px-2 py-0.5 font-serif text-[11px] tracking-[0.14em] transition-opacity hover:opacity-85"
                    style={{
                      color: 'rgba(var(--tj-surface-bg-start), 1)',
                      background: 'linear-gradient(135deg, rgba(var(--tj-btn-primary-start), 0.95), rgba(var(--tj-btn-primary-end), 0.95))',
                      boxShadow: 'inset 0 0 0 1px rgba(var(--tj-btn-primary-start), 0.6)',
                      clipPath: 'polygon(5px 0, 100% 0, 100% calc(100% - 5px), calc(100% - 5px) 100%, 0 100%, 0 5px)',
                    }}
                  >
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                aria-label="关闭提示"
                onClick={() => dismissToast(toast.id)}
                className="shrink-0 px-1 text-[12px] leading-5 transition-opacity hover:opacity-100"
                style={{ color: 'rgba(var(--tj-text-secondary), 0.6)' }}
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
