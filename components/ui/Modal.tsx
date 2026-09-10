import type { ReactNode } from 'react';
import { useEffect, useId, useRef } from 'react';

interface ModalProps {
  children: ReactNode;
  onClose: () => void;
  title?: string;
  className?: string;
  ariaLabel?: string;
}

const activeModalStack: HTMLElement[] = [];
const FOCUSABLE_SELECTOR = [
  '[data-modal-autofocus]',
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function filterVisibleFocusCandidates<T>(
  candidates: readonly T[],
  isVisible: (candidate: T) => boolean,
): T[] {
  return candidates.filter(isVisible);
}

export function resolveTabFocusTarget<T>(
  candidates: readonly T[],
  active: T | null,
  shiftKey: boolean,
  containsActive: boolean,
): T | null {
  if (candidates.length === 0) return null;
  const first = candidates[0];
  const last = candidates[candidates.length - 1];
  if (!containsActive) return shiftKey ? last : first;
  if (shiftKey && active === first) return last;
  if (!shiftKey && active === last) return first;
  return null;
}

export function resolveFocusRestoreTarget<T>(
  previouslyFocused: T | null,
  remainingModal: T | null,
  isConnected: (candidate: T) => boolean,
  remainingContainsPrevious: boolean,
): T | null {
  if (remainingModal) {
    return previouslyFocused && isConnected(previouslyFocused) && remainingContainsPrevious
      ? previouslyFocused
      : remainingModal;
  }
  return previouslyFocused && isConnected(previouslyFocused) ? previouslyFocused : null;
}

function isElementVisible(element: HTMLElement): boolean {
  if (element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
  const view = element.ownerDocument.defaultView;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = view?.getComputedStyle(current);
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') {
      return false;
    }
  }
  const hasLayout = element.getClientRects().length > 0;
  const hasNoLayoutEngine = /jsdom/i.test(view?.navigator.userAgent ?? '');
  return hasLayout || hasNoLayoutEngine;
}

/**
 * 关闭栈顶弹窗：供快捷键（closeTop）等外部调用。
 * 通过向 document 派发合成 Escape 事件复用弹窗自身的关闭逻辑，
 * 保证“Esc 只关栈顶”的语义只有一个实现；无弹窗时为空操作。
 */
export function closeTopModal(): boolean {
  if (activeModalStack.length === 0) return false;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return true;
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return filterVisibleFocusCandidates(
    Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)),
    isElementVisible,
  );
}

export function Modal({ children, onClose, title, className = 'max-w-2xl', ariaLabel = '应用对话框' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activeModalStack.push(dialog);
    document.body.classList.add('modal-open');
    const initialFocus = focusableElements(dialog)[0] ?? dialog;
    initialFocus.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeModalStack[activeModalStack.length - 1] !== dialog) return;
      if (event.key === 'Escape') {
        // 阻断 window 层快捷键监听（closeTop），避免一次 Esc 关掉多个弹窗。
        event.stopPropagation();
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === 'Tab') {
        const elements = focusableElements(dialog);
        if (elements.length === 0) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        const active = document.activeElement;
        const target = resolveTabFocusTarget(
          elements,
          active instanceof HTMLElement ? active : null,
          event.shiftKey,
          dialog.contains(active),
        );
        if (target) {
          event.preventDefault();
          target.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const stackIndex = activeModalStack.lastIndexOf(dialog);
      if (stackIndex >= 0) activeModalStack.splice(stackIndex, 1);
      const remainingModal = activeModalStack[activeModalStack.length - 1];
      if (!remainingModal) document.body.classList.remove('modal-open');
      const restoreTarget = resolveFocusRestoreTarget(
        previouslyFocused,
        remainingModal ?? null,
        (candidate) => candidate.isConnected,
        Boolean(previouslyFocused && remainingModal?.contains(previouslyFocused)),
      );
      restoreTarget?.focus();
    };
  }, []);

  return (
    <div
      className="teyvat-modal-overlay journal-modal-overlay fixed inset-0 z-50 flex items-stretch justify-center p-0 md:items-center md:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className={`teyvat-modal-shell journal-modal-shell journal-paper-surface flex h-[100dvh] w-full min-w-0 animate-slide-up flex-col overflow-hidden md:h-auto md:max-h-[85vh] ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        tabIndex={-1}
      >
        {title && (
          <>
            <div className="flex items-center justify-between gap-3 px-4 py-3.5 md:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-base" style={{ color: 'rgba(var(--tj-accent-primary), 0.7)' }}>◆</span>
                <h2
                  id={titleId}
                  className="min-w-0 truncate font-serif text-lg font-bold tracking-[0.2em]"
                  style={{
                    background: 'linear-gradient(180deg, rgb(var(--tj-text-primary)) 0%, rgb(var(--tj-accent-primary)) 60%, rgb(var(--tj-accent-secondary)) 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }}
                >
                  {title}
                </h2>
              </div>
              <button
                onClick={onClose}
                className="teyvat-close-btn journal-focus-target flex h-11 w-11 items-center justify-center text-lg leading-none"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <div className="teyvat-divider mx-5" />
          </>
        )}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-5">{children}</div>
      </div>
    </div>
  );
}
