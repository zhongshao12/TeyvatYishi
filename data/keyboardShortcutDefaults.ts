export type 快捷键动作 = 'reroll' | 'save' | 'systemDrawer' | 'courier' | 'commandPalette' | 'closeTop';

export interface 快捷键绑定 {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export const KEYBOARD_SHORTCUT_DEFAULTS: Record<快捷键动作, 快捷键绑定> = {
  // 游戏式键位：Ctrl+R/S/O 与浏览器原生快捷键冲突（Ctrl+R 刷新会丢掉进行中的 AI 回合），
  // 改用 Alt 组合键，贴近原神「B 背包 / M 地图」的游戏手习惯。
  reroll: { key: 'r', alt: true },
  save: { key: 's', alt: true },
  systemDrawer: { key: 'o', alt: true },
  courier: { key: 'm', alt: true },
  commandPalette: { key: 'k', ctrl: true },
  closeTop: { key: 'Escape' },
};

export const KEYBOARD_SHORTCUT_ACTIONS: 快捷键动作[] = ['reroll', 'save', 'systemDrawer', 'courier', 'commandPalette', 'closeTop'];

export const KEYBOARD_SHORTCUT_LABELS: Record<快捷键动作, string> = {
  reroll: '重新生成（重 roll）',
  save: '手动存档',
  systemDrawer: '打开 / 关闭系统抽屉',
  courier: '打开手机',
  commandPalette: '命令面板',
  closeTop: '关闭顶层弹窗',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBinding(value: unknown, fallback: 快捷键绑定): 快捷键绑定 {
  if (!isRecord(value) || typeof value.key !== 'string' || !value.key.trim()) return { ...fallback };
  return {
    key: value.key,
    ...(typeof value.ctrl === 'boolean' ? { ctrl: value.ctrl } : {}),
    ...(typeof value.shift === 'boolean' ? { shift: value.shift } : {}),
    ...(typeof value.alt === 'boolean' ? { alt: value.alt } : {}),
  };
}

export function 归一化快捷键绑定表(input: unknown): Record<快捷键动作, 快捷键绑定> {
  const raw = isRecord(input) ? input : {};
  return Object.fromEntries(KEYBOARD_SHORTCUT_ACTIONS.map((action) => {
    const value = action === 'courier' ? raw.courier ?? raw.phone : raw[action];
    return [action, normalizeBinding(value, KEYBOARD_SHORTCUT_DEFAULTS[action])];
  })) as Record<快捷键动作, 快捷键绑定>;
}

export function 格式化快捷键绑定(binding: 快捷键绑定): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.shift) parts.push('Shift');
  if (binding.alt) parts.push('Alt');
  parts.push(binding.key === 'Escape' ? 'Esc' : binding.key.length === 1 ? binding.key.toUpperCase() : binding.key);
  return parts.join(' + ');
}
