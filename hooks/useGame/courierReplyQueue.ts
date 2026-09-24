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

export interface CourierReplyQueueOptions {
  getSessionId: () => number;
  dispatch: (batch: CourierReplyBatchIntent) => Promise<CourierReplyDispatchResult>;
  delayMs?: number;
}

interface PendingConversation {
  sessionId: number;
  pendingIds: string[];
  ready: boolean;
  failed: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/** Serializes phone model work without losing messages sent during an active request. */
export function createCourierReplyQueue(options: CourierReplyQueueOptions) {
  const delayMs = Math.max(0, options.delayMs ?? 500);
  const pending = new Map<string, PendingConversation>();
  let activeToken: number | null = null;
  let activeSessionId: number | null = null;
  let nextToken = 0;
  let disposed = false;

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

  const pump = async (): Promise<void> => {
    if (disposed) return;
    removeOldSessions();
    if (activeToken !== null) return;
    const next = [...pending].find(([, entry]) => entry.ready && !entry.failed && entry.pendingIds.length);
    if (!next) return;
    const [conversationId, entry] = next;
    entry.ready = false;
    const messageIds = entry.pendingIds.splice(0);
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
      if (result !== 'sent') {
        entry.pendingIds = [...messageIds, ...entry.pendingIds.filter((id) => !messageIds.includes(id))];
        if (result === 'retry') {
          clearTimer(entry);
          entry.ready = false;
          entry.failed = true;
        } else {
          schedule(conversationId, entry);
        }
      } else if (!entry.pendingIds.length) {
        clearTimer(entry);
        pending.delete(conversationId);
      }
    }
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
    enqueue(intent: CourierReplyIntent): void {
      if (disposed || !intent.conversationId || !intent.messageId) return;
      removeOldSessions();
      if (intent.sessionId !== options.getSessionId()) return;
      let entry = pending.get(intent.conversationId);
      if (!entry) {
        entry = { sessionId: intent.sessionId, pendingIds: [], ready: false, failed: false };
        pending.set(intent.conversationId, entry);
      }
      if (!entry.pendingIds.includes(intent.messageId)) entry.pendingIds.push(intent.messageId);
      if (!entry.failed) schedule(intent.conversationId, entry);
    },
    retry(conversationId: string): void {
      if (disposed) return;
      removeOldSessions();
      const entry = pending.get(conversationId);
      if (!entry?.failed || !entry.pendingIds.length) return;
      entry.failed = false;
      entry.ready = true;
      void pump();
    },
    invalidateSession(): void {
      clearAll();
      activeToken = null;
      activeSessionId = null;
    },
    dispose(): void {
      disposed = true;
      clearAll();
      activeToken = null;
      activeSessionId = null;
    },
  };
}
