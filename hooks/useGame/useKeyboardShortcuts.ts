import { useEffect } from 'react';
import type { 快捷键动作, 快捷键绑定 } from '@/data/keyboardShortcutDefaults';

export interface KeyboardShortcutHandlers {
  reroll?: () => void;
  save?: () => void;
  systemDrawer?: () => void;
  courier?: () => void;
  commandPalette?: () => void;
  closeTop?: () => void;
}

function matchesEvent(binding: 快捷键绑定, event: KeyboardEvent): boolean {
  if (binding.key === 'Escape') return event.key === 'Escape';
  return event.key.toLowerCase() === binding.key.toLowerCase()
    && Boolean(event.ctrlKey) === Boolean(binding.ctrl)
    && Boolean(event.shiftKey) === Boolean(binding.shift)
    && Boolean(event.altKey) === Boolean(binding.alt);
}

/** 全局快捷键：不覆盖输入框 / 文本域 / 可编辑元素。 */
export function useKeyboardShortcuts(
  handlers: KeyboardShortcutHandlers,
  bindings: Record<快捷键动作, 快捷键绑定>,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      // 弹窗打开时全局快捷键必须让位：否则在读档/设置弹窗之上按 Alt+R 会重掷当前回合、
      // Ctrl+K 会在弹窗之上再叠一层命令面板。`Modal` 已经在维护 body.modal-open 这个现成标志。
      if (typeof document !== 'undefined' && document.body.classList.contains('modal-open')) return;
      for (const [action, binding] of Object.entries(bindings) as Array<[快捷键动作, 快捷键绑定]>) {
        if (matchesEvent(binding, event)) {
          const handler = handlers[action];
          if (handler) {
            event.preventDefault();
            handler();
            return;
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bindings, enabled, handlers]);
}
