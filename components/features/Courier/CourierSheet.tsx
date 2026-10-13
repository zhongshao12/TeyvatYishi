import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModalAccessibility } from '@/components/ui/Modal';

export function CourierSheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  const dialogRef = useModalAccessibility<HTMLElement>(onClose);
  return createPortal(<div className="teyvat-modal-overlay fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-2 sm:p-4" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
      className="journal-story-page journal-phone flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-2xl sm:max-h-[90dvh]">
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <h2 className="font-serif text-lg">{title}</h2>
        <button type="button" className="min-h-11 min-w-11" aria-label={`关闭${title}`} onClick={onClose}>✕</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
      <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t p-3" style={{ background: 'rgb(var(--tj-surface-strong))' }}>{footer}</footer>
    </section>
  </div>, document.body);
}
