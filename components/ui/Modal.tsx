import type { ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

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
  if (!containsActive) return (shiftKey ? last : first) ?? null;
  if (shiftKey && active === first) return last ?? null;
  if (!shiftKey && active === last) return first ?? null;
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

/**
 * 为自定义外观的弹窗复用与 Modal 相同的 Esc、焦点圈定、焦点恢复和栈顶语义。
 * ref 必须挂在真正的 role="dialog" 容器上，而不是遮罩层上。
 */
export function useModalAccessibility<T extends HTMLElement>(onClose: () => void, enabled = true) {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!enabled || !dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    activeModalStack.push(dialog);
    document.body.classList.add('modal-open');
    const initialFocus = focusableElements(dialog)[0] ?? dialog;
    initialFocus.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeModalStack[activeModalStack.length - 1] !== dialog) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
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
  }, [enabled]);

  return dialogRef;
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
  const dialogRef = useModalAccessibility<HTMLDivElement>(onClose);
  const titleId = useId();

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

export interface ConfirmDialogRequest {
  /** 同时用作对话框的可访问名（aria-label）。 */
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger 用危险色渲染确认按钮。 */
  tone?: 'default' | 'danger';
}

export interface ConfirmDialogApi {
  /** 打开一个可样式化的确认弹窗，返回玩家是否确认。 */
  confirm: (request: ConfirmDialogRequest) => Promise<boolean>;
  /** 结算当前弹窗；由 ConfirmDialogHost 调用。 */
  resolve: (confirmed: boolean) => void;
  /** 当前待确认的请求（无则为 null）。 */
  pending: (ConfirmDialogRequest & { key: number }) | null;
}

interface PendingConfirm extends ConfirmDialogRequest {
  key: number;
}

/**
 * 用样式化弹窗替代原生 window.confirm。
 * 原生 confirm 无法换主题、无法读屏标注、也无法在移动端保持应用外观。
 */
export function useConfirmDialog(): ConfirmDialogApi {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const seqRef = useRef(0);

  const confirm = useCallback((request: ConfirmDialogRequest) => new Promise<boolean>((resolve) => {
    // 同一时刻只允许一个待确认请求：前一个按“取消”结算，避免 Promise 悬空。
    resolverRef.current?.(false);
    resolverRef.current = resolve;
    seqRef.current += 1;
    setPending({ key: seqRef.current, ...request });
  }), []);

  const resolve = useCallback((confirmed: boolean) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    resolver?.(confirmed);
  }, []);

  return { confirm, resolve, pending };
}

/**
 * 承载 useConfirmDialog 的弹窗节点。放在组件树任意位置即可。
 */
export function ConfirmDialogHost({ dialog }: { dialog: ConfirmDialogApi }) {
  if (!dialog.pending) return null;
  return <ConfirmDialog key={dialog.pending.key} request={dialog.pending} onResolve={dialog.resolve} />;
}

export function ConfirmDialog({ request, onResolve }: { request: ConfirmDialogRequest; onResolve: (confirmed: boolean) => void }) {
  const dialogRef = useModalAccessibility<HTMLDivElement>(() => onResolve(false));
  const danger = request.tone === 'danger';
  return (
    <div
      className="teyvat-modal-overlay journal-modal-overlay fixed inset-0 z-[130] flex items-center justify-center p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onResolve(false); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        tabIndex={-1}
        className="journal-modal-shell journal-paper-surface w-[min(440px,94vw)] animate-slide-up p-4 text-[rgb(var(--tj-text-primary))] md:p-5"
        style={{ boxShadow: `inset 0 0 0 1px ${danger ? 'rgba(var(--tj-danger), 0.6)' : 'rgba(var(--tj-accent-primary), 0.5)'}, 0 20px 50px rgba(var(--tj-shadow), 0.42)` }}
      >
        <h3 className="font-serif text-base font-bold tracking-[0.2em]" style={{ color: danger ? 'rgb(var(--tj-danger))' : 'rgb(var(--tj-accent-primary))' }}>
          {request.title}
        </h3>
        <p className="mt-2 whitespace-pre-wrap break-words font-serif text-[13px] leading-6" style={{ color: 'rgba(var(--tj-text-primary), 0.92)' }}>
          {request.message}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            data-modal-autofocus
            onClick={() => onResolve(false)}
            className="px-3 py-1.5 font-serif text-[12px] tracking-[0.18em]"
            style={{ color: 'rgb(var(--tj-text-primary))', boxShadow: 'inset 0 0 0 1px rgba(var(--tj-accent-primary), 0.4)' }}
          >
            {request.cancelLabel ?? '取消'}
          </button>
          <button
            type="button"
            onClick={() => onResolve(true)}
            className="px-3 py-1.5 font-serif text-[12px] tracking-[0.18em]"
            style={{
              color: 'rgb(var(--tj-on-accent))',
              background: danger
                ? 'linear-gradient(135deg, rgba(var(--tj-danger), 0.95), rgba(var(--tj-danger), 0.85))'
                : 'linear-gradient(135deg, rgb(var(--tj-btn-primary-start)), rgb(var(--tj-btn-primary-end)))',
              boxShadow: 'inset 0 0 0 1px rgba(var(--tj-text-primary), 0.35)',
            }}
          >
            {request.confirmLabel ?? '确定'}
          </button>
        </div>
      </div>
    </div>
  );
}
