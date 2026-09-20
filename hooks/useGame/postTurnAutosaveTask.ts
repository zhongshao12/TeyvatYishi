export interface PostTurnAutosaveTaskInput<T> {
  enabled: boolean;
  build: () => T;
  assertActive: () => void;
  persist: (payload: T) => Promise<unknown>;
  commit: (payload: T) => void;
  markSaved: () => void;
}

export async function runPostTurnAutosaveTask<T>(
  input: PostTurnAutosaveTaskInput<T>,
): Promise<{ status: 'skipped' | 'saved'; payload?: T }> {
  if (!input.enabled) return { status: 'skipped' };
  const payload = input.build();
  input.assertActive();
  await input.persist(payload);
  input.commit(payload);
  input.assertActive();
  input.markSaved();
  return { status: 'saved', payload };
}
