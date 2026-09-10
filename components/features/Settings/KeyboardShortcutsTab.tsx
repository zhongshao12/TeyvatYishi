import { useState } from 'react';
import type { 游戏设置 } from '@/models/settings';
import { KEYBOARD_SHORTCUT_ACTIONS, KEYBOARD_SHORTCUT_DEFAULTS, KEYBOARD_SHORTCUT_LABELS, 格式化快捷键绑定, type 快捷键动作, type 快捷键绑定 } from '@/data/keyboardShortcutDefaults';

interface KeyboardShortcutsTabProps {
  settings: 游戏设置;
  onChange: (s: 游戏设置) => void;
}

const smallClip = 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)';

export function KeyboardShortcutsTab({ settings, onChange }: KeyboardShortcutsTabProps) {
  const [capturing, setCapturing] = useState<快捷键动作 | null>(null);
  const current = { ...KEYBOARD_SHORTCUT_DEFAULTS, ...(settings.keyboardShortcuts ?? {}) } as Record<快捷键动作, 快捷键绑定>;

  const update = (action: 快捷键动作, binding: 快捷键绑定) => {
    onChange({ ...settings, keyboardShortcuts: { ...(settings.keyboardShortcuts ?? {}), [action]: binding } });
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!capturing) return;
    event.preventDefault();
    event.stopPropagation();
    update(capturing, { key: event.key === "Escape" ? "Escape" : event.key, ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey });
    setCapturing(null);
  };

  return (
    <div className="space-y-3" onKeyDown={handleKeyDown}>
      <div className="px-3 py-2 text-xs leading-relaxed" style={{ color: "rgba(var(--tj-text-secondary),0.78)", boxShadow: "inset 0 0 0 1px rgba(var(--tj-accent-primary),0.16)", clipPath: smallClip }}>
        快捷键只在游戏界面生效，输入框与文本域中不拦截按键。点击「改键」后按下新的组合键即可绑定；Esc 键可绑定为关闭弹窗。
      </div>
      {KEYBOARD_SHORTCUT_ACTIONS.map((action) => (
        <div key={action} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" style={{ background: "rgba(var(--tj-accent-primary),0.04)", boxShadow: "inset 0 0 0 1px rgba(var(--tj-border),0.45)", clipPath: smallClip }}>
          <div className="min-w-0">
            <div className="text-sm" style={{ color: "rgb(var(--tj-text-primary))" }}>{KEYBOARD_SHORTCUT_LABELS[action]}</div>
            <div className="mt-0.5 text-[11px]" style={{ color: "rgba(var(--tj-accent-primary),0.88)" }}>{格式化快捷键绑定(current[action])}</div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setCapturing(capturing === action ? null : action)} className="px-3 py-1.5 text-xs" style={{ color: "rgb(var(--tj-text-primary))", background: capturing === action ? "rgba(var(--tj-accent-primary),0.22)" : "rgba(var(--tj-accent-primary),0.08)", boxShadow: "inset 0 0 0 1px rgba(var(--tj-accent-primary),0.35)", clipPath: smallClip }}>
              {capturing === action ? "按新组合键…" : "改键"}
            </button>
            <button type="button" onClick={() => update(action, KEYBOARD_SHORTCUT_DEFAULTS[action])} className="px-3 py-1.5 text-xs" style={{ color: "rgba(var(--tj-text-secondary),0.8)", boxShadow: "inset 0 0 0 1px rgba(var(--tj-border),0.5)", clipPath: smallClip }}>恢复默认</button>
          </div>
        </div>
      ))}
    </div>
  );
}
