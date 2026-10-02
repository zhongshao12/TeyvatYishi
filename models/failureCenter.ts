/**
 * 失败结算中心的数据模型（2026-09-29，用户第 5 项）。
 *
 * 目标：把散落在 toast / 队列 / 控制台 / 各自横幅里的失败收进**一处可查、可重试、可忽略**的清单，
 * 并明确分工 —— toast 只说「刚刚发生了什么」（瞬时），队列说「本回合跑了什么」（25 条），
 * 变量回执说「哪些变量落地了」（正文内联），**中心说「现在还有什么没解决」**（持久、可展开诊断）。
 *
 * 字段语义直接沿用仓库里已经验证过的记忆失败草稿（`models/memory.ts` 的
 * `failureCode` / `failureMessage` / `attemptCount` / `status` / 可展开原始材料 / 重试与忽略），
 * 不另发明一套。
 */

export type FailureSource =
  | 'main_story' | 'variable' | 'memory' | 'irminsul' | 'autosave' | 'save' | 'quest'
  | 'courier' | 'courier_reply' | 'moments' | 'image' | 'codex' | 'world_evolution'
  | 'content_resource' | 'settings' | 'recovery' | 'diagnostics' | 'npc' | 'steambird' | 'chapter';

export type FailureRetryability = 'auto' | 'manual' | 'none';

export type FailureStatus = 'open' | 'retrying' | 'resolved' | 'ignored';

export interface FailureItem {
  /** 稳定 id：`${source}:${dedupeKey}` —— 同一问题重复发生只累加次数，不刷屏。 */
  id: string;
  source: FailureSource;
  /** 发生时的回合号（拿不到记 null，不编造）。 */
  turn: number | null;
  /** 现实时间（技术记录时间），与游戏世界时刻分开存放。 */
  occurredAt: number;
  /** 发生时的游戏世界时刻快照（旧数据缺失即省略，绝不回填当前世界状态）。 */
  context?: { date?: string; time?: string; location?: string };
  /** 机器可读原因码（用于分组与门禁断言）。 */
  reasonCode: string;
  /** 人类可读原因（界面主文案）。 */
  humanReason: string;
  retryable: FailureRetryability;
  /** 重试按钮文案（manual 时展示）。 */
  retryLabel?: string;
  status: FailureStatus;
  attemptCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  dedupeKey: string;
  /** 诊断信息；`visibleTo: 'developer'` 的原文只在「查看原始材料」里展开。 */
  diagnostic?: { visibleTo: 'player' | 'developer'; text: string; apiErrorReportId?: string };
}

/** 上限：`open` 永不因上限被挤掉（沿用 toastStore 里 B1 审计的教训）。 */
export const FAILURE_CENTER_LIMIT = 200;

export interface ReportFailureInput {
  source: FailureSource;
  reasonCode: string;
  humanReason: string;
  dedupeKey?: string;
  retryable?: FailureRetryability;
  retryLabel?: string;
  turn?: number | null;
  now?: number;
  context?: FailureItem['context'];
  diagnostic?: FailureItem['diagnostic'];
}

export function failureItemId(source: FailureSource, dedupeKey: string): string {
  return `${source}:${dedupeKey}`;
}

/** 归一化/合并同一条失败：重复发生只追加次数与时间，已解决/已忽略的重新出现则回到 open。 */
export function mergeFailureItem(existing: FailureItem | undefined, incoming: FailureItem): FailureItem {
  if (!existing) return incoming;
  const reopened = incoming.status === 'open' && (existing.status === 'resolved' || existing.status === 'ignored');
  return {
    ...existing,
    ...incoming,
    // 首次发生时间与累计次数跨重复事件保留；解决后再次出现视为新一轮。
    firstSeenAt: reopened ? incoming.firstSeenAt : existing.firstSeenAt,
    attemptCount: reopened ? incoming.attemptCount : existing.attemptCount + incoming.attemptCount,
    status: incoming.status,
    lastSeenAt: incoming.lastSeenAt,
    // 重试入口与诊断文本可能在新一轮里变好/变新，取最新。
    retryLabel: incoming.retryLabel ?? existing.retryLabel,
    diagnostic: incoming.diagnostic ?? existing.diagnostic,
    context: incoming.context ?? existing.context,
  };
}

/**
 * 淘汰：resolved → ignored → 最旧的 open。
 * 与 toastStore 的 `enforceToastLimit` 同精神：**未解决的失败不允许被静默挤掉**。
 */
export function evictFailures(items: readonly FailureItem[], limit = FAILURE_CENTER_LIMIT): FailureItem[] {
  if (items.length <= limit) return [...items];
  const rank = (item: FailureItem): number => (item.status === 'resolved' ? 0 : item.status === 'ignored' ? 1 : 2);
  const sorted = [...items].sort((a, b) => rank(a) - rank(b) || a.lastSeenAt - b.lastSeenAt);
  const keep = new Set(sorted.slice(Math.max(0, sorted.length - limit)).map((item) => item.id));
  return items.filter((item) => keep.has(item.id));
}

export function countOpenFailures(items: readonly FailureItem[]): number {
  return items.filter((item) => item.status === 'open' || item.status === 'retrying').length;
}

/** 非持久化的重试入口注册表：与 toast 的 action 同构，由上报方在当次运行内注册。 */
export type FailureRetryRunner = () => void | Promise<void>;
