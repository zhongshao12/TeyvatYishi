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
  dropToast(id);
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

/**
 * 错误提示必须由用户手动关闭，不能自动消失。
 * 其中包含「自动保存失败」这类丢档风险信息：若按 polite 队列排后、几秒后自行消失，
 * 玩家既可能没听到，也可能在看到之前就丢失了唯一的失败信号。
 * 显式传入 durationMs 时仍以调用方为准（便于需要短提示的特殊场景）。
 */
function resolveDurationMs(input: PushToastInput, kind: ToastItem['kind']): number | null {
  if (input.durationMs !== undefined) return input.durationMs;
  if (kind === 'error') return null;
  return DEFAULT_DURATION_MS;
}

/** 不可被后续提示挤掉的 toast：错误提示与带操作按钮（撤销/重试）的提示。 */
function isPinnedToast(item: ToastItem): boolean {
  return item.kind === 'error' || Boolean(item.action);
}

function dropToast(id: number): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

/**
 * 超出可见上限时淘汰最旧的**普通**提示。
 *
 * 原先直接 `slice(-(MAX_VISIBLE - 1))`：不分 kind、也不 clearTimeout。
 * 而 error toast **不会自动消失**（`resolveDurationMs` 返回 null），所以它们会长期占位，
 * 一旦同一回合再推 4 条提示（任务更新/蒸汽鸟报/手机消息/手机回复/故事快照）就被静默挤出数组 ——
 * 「自动保存失败」消失、带撤销的提示被提前掐断（第二轮审计 B1）。
 * 所以：错误与带操作的提示**不参与淘汰**；只在普通 info 提示里淘汰最旧的。
 */
function enforceToastLimit(): void {
  const pinned = toasts.filter(isPinnedToast);
  const evictable = toasts.filter((item) => !isPinnedToast(item));
  const evictableBudget = Math.max(0, MAX_VISIBLE - pinned.length);
  if (evictable.length <= evictableBudget) return;
  const dropped = evictable.slice(0, evictable.length - evictableBudget);
  for (const item of dropped) dropToast(item.id);
  const droppedIds = new Set(dropped.map((item) => item.id));
  toasts = toasts.filter((item) => !droppedIds.has(item.id));
}

export function pushToast(input: PushToastInput): number {
  const kind = input.kind ?? 'info';
  const item: ToastItem = {
    id: nextId++,
    kind,
    title: input.title,
    detail: input.detail?.trim() ? input.detail : undefined,
    action: input.action,
  };
  toasts = [...toasts, item];
  enforceToastLimit();
  emitChange();
  const durationMs = resolveDurationMs(input, kind);
  if (durationMs === null) return item.id;
  const timer = setTimeout(() => dismissToast(item.id), durationMs);
  timers.set(item.id, timer);
  return item.id;
}
