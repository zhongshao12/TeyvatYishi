import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

interface SystemDrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  glyph?: string;
  onClose: () => void;
  children: ReactNode;
}

// 系统面板弹窗（G 阶段后升级）：由内嵌抽屉升级为大号手账弹窗。
// 套用 journal-story-page 让内部 --tj-* 翻转为羊皮纸色，所有系统面板自动获得日式西幻皮肤；
// 内容超长时在弹窗内部滚动。
export function SystemDrawer({ open, title, subtitle, glyph, onClose, children }: SystemDrawerProps) {
  if (!open) {
    return (
      <div aria-hidden style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {null}
      </div>
    );
  }
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <section
        className="journal-story-page relative flex h-[min(92vh,880px)] w-[min(1120px,97vw)] flex-col overflow-hidden"
        style={{
          boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.4), inset 0 0 0 7px rgba(0, 0, 0, 0.08), 0 30px 70px rgba(0, 0, 0, 0.55)',
          clipPath: 'polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px)',
        }}
      >
        <header
          className="flex items-center gap-3 px-5 py-3.5"
          style={{ borderBottom: '1px solid rgba(var(--tj-accent-primary), 0.3)' }}
        >
          {glyph && (
            <span
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center font-serif text-lg"
              style={{
                color: 'rgb(var(--tj-accent-primary))',
                background: 'linear-gradient(135deg, rgba(var(--tj-accent-primary), 0.14), rgba(var(--tj-accent-primary), 0.03))',
                boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.45)',
                clipPath: 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)',
              }}
            >
              {glyph}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-serif text-xl font-semibold tracking-[0.24em]" style={{ color: 'rgb(var(--tj-accent-primary))' }}>
              {title}
            </h3>
            {subtitle && (
              <p className="mt-0.5 truncate font-serif text-[12px] italic leading-relaxed tracking-[0.12em]" style={{ color: 'rgba(var(--tj-text-secondary), 0.9)' }}>
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭面板"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center font-serif text-lg transition-all hover:opacity-80"
            style={{ color: 'rgba(var(--tj-text-secondary), 0.85)', boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.3)', clipPath: 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)' }}
          >
            ✕
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4">{children}</div>
      </section>
    </div>,
    document.body,
  );
}
