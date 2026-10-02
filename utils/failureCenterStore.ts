import { loadSetting, saveSetting } from '@/services/dbService';
import {
  countOpenFailures,
  evictFailures,
  failureItemId,
  mergeFailureItem,
  type FailureItem,
  type FailureRetryRunner,
  type ReportFailureInput,
} from '@/models/failureCenter';

/**
 * 失败结算中心（2026-09-29，用户第 5 项）。
 *
 * 与 `utils/toastStore.ts` 相同的模式：模块级单例 + `useSyncExternalStore` 订阅，
 * 让服务层（sendWorkflow / questWorkflow / courier 后台任务…）都能上报，
 * 且不经过 App 全局状态、不触发整树重渲染。
 *
 * 与 toast 的分工：toast 是「刚刚发生了什么」的瞬时通知（会消失），
 * 中心是「现在还有什么没解决」的持久清单（`open` 不会被上限挤掉，也不因整屏刷新而丢）。
 * 因此中心**不**自己弹 toast，只维护清单与未解决计数。
 */

export const FAILURE_CENTER_KEY = 'failureCenterV1';

type Listener = () => void;

let items: FailureItem[] = [];
const listeners = new Set<Listener>();
const retryRunners = new Map<string, FailureRetryRunner>();
let loaded = false;
let loadPromise: Promise<void> | null = null;

function emitChange(): void {
  for (const listener of listeners) listener();
}

export function subscribeFailureCenter(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getFailureCenter(): FailureItem[] {
  return items;
}

export function getOpenFailureCount(): number {
  return countOpenFailures(items);
}

/** 供上报方注册当次运行内的重试入口（不参与持久化，重启后由队列/草稿自行恢复重试能力）。 */
export function registerFailureRetry(id: string, runner: FailureRetryRunner): void {
  retryRunners.set(id, runner);
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist(): void {
  if (typeof window === 'undefined') return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void saveSetting(FAILURE_CENTER_KEY, items).catch((error) => {
      // 诊断不能因为「写诊断失败」而完全静默（用户第 5 项点名的静默失败之一）。
      console.warn('[failure-center] 失败结算清单持久化失败', error);
    });
  }, 300);
}

export function reportFailure(input: ReportFailureInput): FailureItem {
  const now = input.now ?? Date.now();
  const dedupeKey = input.dedupeKey?.trim() || input.reasonCode;
  const id = failureItemId(input.source, dedupeKey);
  const incoming: FailureItem = {
    id,
    source: input.source,
    turn: input.turn ?? null,
    occurredAt: now,
    reasonCode: input.reasonCode,
    humanReason: input.humanReason,
    retryable: input.retryable ?? 'none',
    status: 'open',
    attemptCount: 1,
    firstSeenAt: now,
    lastSeenAt: now,
    dedupeKey,
    ...(input.retryLabel ? { retryLabel: input.retryLabel } : {}),
    ...(input.context ? { context: input.context } : {}),
    ...(input.diagnostic ? { diagnostic: input.diagnostic } : {}),
  };
  const existing = items.find((item) => item.id === id);
  const merged = mergeFailureItem(existing, incoming);
  items = evictFailures([merged, ...items.filter((item) => item.id !== id)]);
  emitChange();
  schedulePersist();
  return merged;
}

function patchFailure(id: string, patch: (item: FailureItem) => FailureItem): void {
  let changed = false;
  items = items.map((item) => {
    if (item.id !== id) return item;
    changed = true;
    return patch(item);
  });
  if (!changed) return;
  emitChange();
  schedulePersist();
}

export function beginFailureRetry(id: string): void {
  patchFailure(id, (item) => ({ ...item, status: 'retrying', attemptCount: item.attemptCount + 1, lastSeenAt: Date.now() }));
}

export function resolveFailure(id: string): void {
  retryRunners.delete(id);
  patchFailure(id, (item) => ({ ...item, status: 'resolved', lastSeenAt: Date.now() }));
}

export function failFailureRetry(id: string, detail?: string): void {
  patchFailure(id, (item) => ({
    ...item,
    status: 'open',
    lastSeenAt: Date.now(),
    ...(detail ? { diagnostic: { visibleTo: 'developer' as const, text: detail } } : {}),
  }));
}

export function ignoreFailure(id: string): void {
  patchFailure(id, (item) => ({ ...item, status: 'ignored', lastSeenAt: Date.now() }));
}

/** 从中心触发一次重试：先标记 retrying，再由注册的入口执行；失败则回到 open 并保留诊断。 */
export async function runFailureRetry(id: string): Promise<boolean> {
  const runner = retryRunners.get(id);
  const item = items.find((entry) => entry.id === id);
  if (!runner || !item || item.retryable === 'none') return false;
  beginFailureRetry(id);
  try {
    await runner();
    resolveFailure(id);
    return true;
  } catch (error) {
    failFailureRetry(id, error instanceof Error ? error.message : String(error));
    return false;
  }
}

export function hasFailureRetryRunner(id: string): boolean {
  return retryRunners.has(id);
}

/** 启动时载入历史清单（只做可验证的归一化，不补造字段）。 */
export async function ensureFailureCenterLoaded(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const stored = await loadSetting<unknown>(FAILURE_CENTER_KEY);
      if (Array.isArray(stored)) {
        const restored = stored.flatMap((entry): FailureItem[] => {
          if (!entry || typeof entry !== 'object') return [];
          const raw = entry as Partial<FailureItem>;
          if (!raw.id || !raw.source || !raw.reasonCode || !raw.humanReason) return [];
          return [{
            id: String(raw.id),
            source: raw.source,
            turn: typeof raw.turn === 'number' ? raw.turn : null,
            occurredAt: Number(raw.occurredAt) || 0,
            reasonCode: String(raw.reasonCode),
            humanReason: String(raw.humanReason),
            retryable: raw.retryable === 'manual' || raw.retryable === 'auto' ? raw.retryable : 'none',
            status: raw.status === 'resolved' || raw.status === 'ignored' || raw.status === 'retrying' ? raw.status : 'open',
            attemptCount: Math.max(1, Math.trunc(Number(raw.attemptCount) || 1)),
            firstSeenAt: Number(raw.firstSeenAt) || 0,
            lastSeenAt: Number(raw.lastSeenAt) || 0,
            dedupeKey: String(raw.dedupeKey ?? raw.reasonCode),
            ...(raw.retryLabel ? { retryLabel: String(raw.retryLabel) } : {}),
            ...(raw.context ? { context: raw.context } : {}),
            ...(raw.diagnostic ? { diagnostic: raw.diagnostic } : {}),
          }];
        });
        // 重启后「重试中」不再有执行者，回到 open 让玩家重新决定。
        items = evictFailures(restored.map((item) => (item.status === 'retrying' ? { ...item, status: 'open' as const } : item)));
        emitChange();
      }
    } catch (error) {
      console.warn('[failure-center] 失败结算清单读取失败', error);
    } finally {
      loaded = true;
      loadPromise = null;
    }
  })();
  return loadPromise;
}

/** 测试用：清空内存态（不删除已持久化数据）。 */
export function resetFailureCenterMemory(): void {
  items = [];
  retryRunners.clear();
  loaded = false;
  loadPromise = null;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  emitChange();
}
