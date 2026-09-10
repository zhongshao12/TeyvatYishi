// 应用内 toast 通知中心的外部存储。
// 与 streamingMessageStore 相同的模式：模块级单例 + useSyncExternalStore 订阅，
// 让任意服务层（sendWorkflow / questWorkflow 等非 React 代码）都能推送提示，
// 且不经过 App 全局状态、不触发整树重渲染。

export interface ToastItem {
  id: number;
  kind: 'info' | 'success' | 'error';
  title: string;
  detail?: string;
  /** 可选操作按钮（如“重试本回合”）。 */
  action?: ToastAction;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

type ToastListener = () => void;

const MAX_VISIBLE = 4;
const DEFAULT_DURATION_MS = 4600;

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<ToastListener>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): ToastItem[] {
  return toasts;
}

export function dismissToast(id: number): void {
  if (!toasts.some((item) => item.id === id)) return;
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toasts = toasts.filter((item) => item.id !== id);
  emitChange();
}

export interface PushToastInput {
  kind?: ToastItem['kind'];
  title: string;
  detail?: string;
  durationMs?: number;
  action?: ToastAction;
}

export function pushToast(input: PushToastInput): number {
  const item: ToastItem = {
    id: nextId++,
    kind: input.kind ?? 'info',
    title: input.title,
    detail: input.detail?.trim() ? input.detail : undefined,
    action: input.action,
  };
  // 超出可见上限时挤掉最旧的提示。
  toasts = [...toasts.slice(-(MAX_VISIBLE - 1)), item];
  emitChange();
  const timer = setTimeout(() => dismissToast(item.id), input.durationMs ?? DEFAULT_DURATION_MS);
  timers.set(item.id, timer);
  return item.id;
}
