export interface PostTurnAutosaveTaskInput<T> {
  enabled: boolean;
  build: () => T;
  assertActive: () => void;
  /** 非回合存档还需确认内存根和存档树父节点没有在异步写入期间变化。 */
  isCurrent?: () => boolean;
  persist: (payload: T) => Promise<unknown>;
  /** 仅供会话外检查点清理已写盘但失去归属的临时节点。 */
  discardStale?: (persistResult: unknown) => Promise<void>;
  commit: (payload: T) => void;
  markSaved: () => void;
}

export async function runPostTurnAutosaveTask<T>(
  input: PostTurnAutosaveTaskInput<T>,
): Promise<{ status: 'skipped' | 'saved' | 'stale'; payload?: T }> {
  if (!input.enabled) return { status: 'skipped' };
  const payload = input.build();
  input.assertActive();
  if (input.isCurrent && !input.isCurrent()) return { status: 'stale' };
  const persistResult = await input.persist(payload);
  input.assertActive();
  if (input.isCurrent && !input.isCurrent()) {
    await input.discardStale?.(persistResult);
    return { status: 'stale' };
  }
  input.commit(payload);
  input.markSaved();
  return { status: 'saved', payload };
}
