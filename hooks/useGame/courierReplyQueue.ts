export interface CourierReplyIntent {
  conversationId: string;
  messageId: string;
  sessionId: number;
}

export interface CourierReplyBatchIntent {
  conversationId: string;
  messageIds: string[];
  sessionId: number;
}

export type CourierReplyDispatchResult = 'sent' | 'retry' | 'defer';

/** Queue ownership must reflect member-level failures, not just the number of delivered conversations. */
export function classifyCourierReplyResult(result: { replied: number; failedMemberNames?: readonly string[] }): CourierReplyDispatchResult {
  return result.failedMemberNames?.length ? 'retry' : result.replied > 0 ? 'sent' : 'retry';
}

export interface CourierReplyQueueOptions {
  getSessionId: () => number;
  dispatch: (batch: CourierReplyBatchIntent) => Promise<CourierReplyDispatchResult>;
  delayMs?: number;
}

interface PendingConversation {
  sessionId: number;
  /** 尚未拿到回信的玩家消息 id（含等待手动重试的那一批）。 */
  pendingIds: string[];
  /** 模型失败、需要玩家手动重试的 id；自动派发**不会**重发它们。 */
  failedIds: string[];
  /** Keep original request identities so retry never combines distinct group exchanges. */
  failedBatches: string[][];
  retryBatches: string[][];
  /** 本次 ready 由玩家点「重试回信」触发 → 只重发 `failedIds`。 */
  retryRequested: boolean;
  ready: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Serializes phone model work without losing messages sent during an active request.
 *
 * 2026-09-29 修正（用户报的第 8 项「群聊 @全体成员 老是回信失败」的第二层）：
 * 旧实现在一次失败后把会话标成 `failed`，而 `enqueue` 里是 `if (!entry.failed) schedule(...)`
 * —— 于是**之后的新消息再也不自动派发**，界面横幅一直挂着、同会话此后每条消息都「没有回信」。
 * 现在把「失败批次」与「新消息」分开记账：
 * - 新消息照常自动派发（只发未失败的那些 id）；
 * - 失败的那一批仍留给手动 `retry()`，且重试**只**重发这一批，不会把新消息一起再发一遍。
 */
export function createCourierReplyQueue(options: CourierReplyQueueOptions) {
  const delayMs = Math.max(0, options.delayMs ?? 500);
  const pending = new Map<string, PendingConversation>();
  let activeToken: number | null = null;
  let activeSessionId: number | null = null;
  let nextToken = 0;
  let disposed = false;
  let revision = 0;
  const listeners = new Set<() => void>();
  const notify = () => { revision++; for (const listener of listeners) listener(); };

  const clearTimer = (entry: PendingConversation) => {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = undefined;
  };

  const clearAll = () => {
    for (const entry of pending.values()) clearTimer(entry);
    pending.clear();
  };

  const removeOldSessions = () => {
    const current = options.getSessionId();
    if (activeSessionId !== null && activeSessionId !== current) {
      activeToken = null;
      activeSessionId = null;
    }
    for (const [conversationId, entry] of pending) {
      if (entry.sessionId === current) continue;
      clearTimer(entry);
      pending.delete(conversationId);
    }
  };

  /** 本次可以自动派发的 id（排除等待手动重试的失败批次）。 */
  const autoIds = (entry: PendingConversation) => entry.pendingIds.filter((id) => !entry.failedIds.includes(id));
  const readyToSend = (entry: PendingConversation) => (entry.retryRequested
    ? entry.retryBatches.length > 0
    : autoIds(entry).length > 0);

  const pump = async (): Promise<void> => {
    if (disposed) return;
    removeOldSessions();
    if (activeToken !== null) return;
    const next = [...pending].find(([, entry]) => entry.ready && readyToSend(entry));
    if (!next) return;
    const [conversationId, entry] = next;
    entry.ready = false;
    const retrying = entry.retryRequested;
    const sendIds = retrying ? [...entry.retryBatches[0]!] : autoIds(entry);
    const messageIds = sendIds;
    entry.pendingIds = entry.pendingIds.filter((id) => !messageIds.includes(id));
    const token = ++nextToken;
    activeToken = token;
    activeSessionId = entry.sessionId;

    let result: CourierReplyDispatchResult;
    try {
      result = await options.dispatch({ conversationId, messageIds, sessionId: entry.sessionId });
    } catch {
      result = 'retry';
    }
    if (activeToken !== token) return;
    activeToken = null;
    activeSessionId = null;
    if (disposed) return;
    removeOldSessions();
    if (pending.get(conversationId) === entry) {
      const sameBatch = (ids: string[]) => ids.length === messageIds.length && ids.every((id, index) => id === messageIds[index]);
      if (retrying && result !== 'defer') entry.retryBatches = entry.retryBatches.filter((ids) => !sameBatch(ids));
      entry.retryRequested = entry.retryBatches.length > 0;
      if (result === 'sent') {
        entry.failedIds = entry.failedIds.filter((id) => !messageIds.includes(id));
        entry.failedBatches = entry.failedBatches.filter((ids) => !sameBatch(ids));
        if (!entry.pendingIds.length && !entry.failedIds.length) {
          clearTimer(entry);
          pending.delete(conversationId);
        } else if (entry.retryRequested) {
          clearTimer(entry);
          entry.ready = true;
        } else if (!autoIds(entry).length) {
          // 只剩等待手动重试的失败批次：不再自动重发（契约：模型失败不自动重试）。
          clearTimer(entry);
          entry.ready = false;
        } else if (!entry.ready && entry.timer === undefined) {
          // 还有新消息、但既没被标记 ready 也没有挂着的计时器（例如上一次失败把它清掉了）
          // → 必须重新挂窗口，否则这条消息永远不会再被派发（B15）。
          schedule(conversationId, entry);
        }
      } else {
        // 把本次的 id 放回队首。
        entry.pendingIds = [...messageIds, ...entry.pendingIds];
        if (result === 'retry') {
          entry.failedIds = [...new Set([...entry.failedIds, ...messageIds])];
          if (!entry.failedBatches.some(sameBatch)) entry.failedBatches.push([...messageIds]);
          // 只把**这一批**标成待手动重试；期间新到达的消息保留自己的调度窗口。
          // （B15：旧实现无条件 clearTimer + ready=false，把 p2 已到期的调度一起清掉，
          //  于是「重试 p1 之后 p2 仍不发」。）
          if (entry.retryRequested) {
            clearTimer(entry);
            entry.ready = true;
          } else if (autoIds(entry).length) schedule(conversationId, entry);
          else {
            clearTimer(entry);
            entry.ready = false;
          }
        } else {
          // 'defer' = 认领被占用这类**瞬时**冲突：不记为失败，保持本次意图（自动批或玩家手动重试），
          // 500 毫秒后按原节奏自动再试。
          if (!entry.retryRequested) entry.failedIds = entry.failedIds.filter((id) => !messageIds.includes(id));
          schedule(conversationId, entry);
        }
      }
    }
    notify();
    void pump();
  };

  const schedule = (conversationId: string, entry: PendingConversation) => {
    clearTimer(entry);
    entry.ready = false;
    entry.timer = setTimeout(() => {
      entry.timer = undefined;
      if (disposed || pending.get(conversationId) !== entry) return;
      entry.ready = true;
      void pump();
    }, delayMs);
  };

  return {
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => revision,
    // The entry remains owned during dispatch/reveal, and while any failed batch awaits retry.
    isPending: (conversationId: string) => pending.get(conversationId)?.sessionId === options.getSessionId(),
    /** React StrictMode replays effect cleanup/setup on the same mounted queue. */
    activate(): void {
      disposed = false;
    },
    enqueue(intent: CourierReplyIntent): void {
      if (disposed || !intent.conversationId || !intent.messageId) return;
      removeOldSessions();
      if (intent.sessionId !== options.getSessionId()) return;
      let entry = pending.get(intent.conversationId);
      if (!entry) {
        entry = {
          sessionId: intent.sessionId, pendingIds: [], failedIds: [], failedBatches: [], retryBatches: [], retryRequested: false, ready: false,
        };
        pending.set(intent.conversationId, entry);
      }
      if (!entry.pendingIds.includes(intent.messageId) && !entry.failedIds.includes(intent.messageId)) {
        entry.pendingIds.push(intent.messageId);
      }
      // 关键改动：不再因为「这个会话上一批失败过」就拒绝调度 —— 新消息必须照常派发，
      // 失败的旧批次由 failedIds 单独记账、只等手动重试。
      if (!entry.failedIds.includes(intent.messageId)) schedule(intent.conversationId, entry);
      notify();
    },
    retry(conversationId: string, messageIds?: readonly string[]): void {
      if (disposed) return;
      removeOldSessions();
      const entry = pending.get(conversationId);
      if (!entry?.failedIds.length) return;
      entry.retryBatches = entry.failedBatches
        .filter((ids) => !messageIds || (ids.length === messageIds.length && ids.every((id, index) => id === messageIds[index])))
        .map((ids) => [...ids]);
      if (!entry.retryBatches.length) return;
      entry.retryRequested = true;
      entry.ready = true;
      void pump();
    },
    invalidateSession(): void {
      clearAll();
      activeToken = null;
      activeSessionId = null;
      notify();
    },
    dispose(): void {
      disposed = true;
      clearAll();
      activeToken = null;
      activeSessionId = null;
      notify();
    },
  };
}
