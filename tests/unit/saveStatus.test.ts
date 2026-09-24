import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import { createSaveStatusStore, runTrackedSave } from '@/utils/saveStatus';

describe('save status lifecycle', () => {
  it('reports success only after completion and returns to unsaved for a later game change', () => {
    const store = createSaveStatusStore();
    const game = createEmptyTeyvatGameState();
    store.observeGame(1, game);
    expect(store.getSnapshot().phase).toBe('unsaved');
    const token = store.begin(1, game, 'manual');
    expect(store.getSnapshot()).toMatchObject({ phase: 'saving', source: 'manual' });
    store.succeed(token, game, 123);
    expect(store.getSnapshot()).toMatchObject({ phase: 'saved', source: 'manual', savedAt: 123 });
    store.observeGame(1, { ...game, 后台队列: { ...game.后台队列 } });
    expect(store.getSnapshot().phase).toBe('saved');
    store.observeGame(1, { ...game, turnCount: 1 });
    expect(store.getSnapshot().phase).toBe('unsaved');
  });

  it('keeps failure visible across edits and retry until a write actually succeeds', () => {
    const store = createSaveStatusStore();
    const game = createEmptyTeyvatGameState();
    const changed = { ...game, turnCount: 1 };
    store.observeGame(1, game);
    store.fail(store.begin(1, game, 'auto'));
    store.observeGame(1, changed);
    expect(store.getSnapshot().phase).toBe('failed');
    const retry = store.begin(1, changed, 'manual');
    expect(store.getSnapshot()).toMatchObject({ phase: 'saving', hadFailure: true });
    store.cancel(retry);
    expect(store.getSnapshot().phase).toBe('failed');
    const second = store.begin(1, changed, 'manual');
    store.succeed(second, changed, 456);
    expect(store.getSnapshot()).toMatchObject({ phase: 'saved', hadFailure: false, savedAt: 456 });
  });

  it('ignores older attempts and late writes from another session', () => {
    const store = createSaveStatusStore();
    const game = createEmptyTeyvatGameState();
    store.observeGame(1, game);
    const old = store.begin(1, game, 'auto');
    const newest = store.begin(1, game, 'manual');
    store.succeed(old, game, 100);
    expect(store.getSnapshot().phase).toBe('saving');
    store.observeGame(2, { ...game, turnCount: 2 });
    store.fail(newest);
    expect(store.getSnapshot()).toMatchObject({ sessionId: 2, phase: 'unsaved' });
  });

  it('does not claim a newer game was saved by an older snapshot', () => {
    const store = createSaveStatusStore();
    const game = createEmptyTeyvatGameState();
    const token = store.begin(1, game, 'auto');
    store.succeed(token, { ...game, turnCount: 1 }, 123);
    expect(store.getSnapshot()).toMatchObject({ phase: 'unsaved', savedAt: 123 });
  });

  it('adopts the loaded game as already persisted but resets on a new session', () => {
    const store = createSaveStatusStore();
    const game = createEmptyTeyvatGameState();
    store.markLoaded(7, 789);
    store.observeGame(7, game);
    expect(store.getSnapshot()).toMatchObject({ phase: 'saved', savedAt: 789 });
    store.observeGame(8, { ...game, turnCount: 0 });
    expect(store.getSnapshot()).toMatchObject({ sessionId: 8, phase: 'unsaved' });
  });

  it('tracks a real Promise: rejection stays failed and skipped work is not a save', async () => {
    const store = createSaveStatusStore();
    const game = createEmptyTeyvatGameState();
    const problem = new Error('disk unavailable');
    await expect(runTrackedSave(store, 1, game, 'manual', async () => { throw problem; }, () => game))
      .rejects.toBe(problem);
    expect(store.getSnapshot().phase).toBe('failed');
    const skippedWork = async (): Promise<{ status: 'saved' | 'stale' }> => ({ status: 'stale' });
    const result = await runTrackedSave(store, 1, game, 'auto', skippedWork, () => game, (value) => value.status === 'saved');
    expect(result.status).toBe('stale');
    expect(store.getSnapshot().phase).toBe('failed');
    await runTrackedSave(store, 1, game, 'manual', async () => 42, () => game);
    expect(store.getSnapshot().phase).toBe('saved');
  });
});
