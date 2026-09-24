import { describe, expect, it } from 'vitest';
import { runPostTurnAutosaveTask } from '@/hooks/useGame/postTurnAutosaveTask';

describe('post-turn autosave lifecycle', () => {
  it('does not commit a checkpoint if another save advances the tree while persistence runs', async () => {
    let sameParent = true;
    let committed = false;
    const result = await runPostTurnAutosaveTask({
      enabled: true,
      build: () => ({ turn: 2 }),
      assertActive: () => undefined,
      isCurrent: () => sameParent,
      persist: async () => { sameParent = false; },
      commit: () => { committed = true; },
      markSaved: () => undefined,
    });
    expect(result.status).toBe('stale');
    expect(committed).toBe(false);
  });

  it('removes a persisted checkpoint that became stale after a save switch', async () => {
    let active = true;
    const discarded: number[] = [];
    const result = await runPostTurnAutosaveTask({
      enabled: true,
      build: () => ({ turn: 2 }),
      assertActive: () => undefined,
      isCurrent: () => active,
      persist: async () => { active = false; return 42; },
      discardStale: async (id) => { discarded.push(Number(id)); },
      commit: () => undefined,
      markSaved: () => undefined,
    });
    expect(result.status).toBe('stale');
    expect(discarded).toEqual([42]);
  });
  it('does not switch the active save-tree branch after the workflow is superseded during persistence', async () => {
    let active = true;
    let committed = false;
    await expect(runPostTurnAutosaveTask({
      enabled: true,
      build: () => ({ turn: 2 }),
      assertActive: () => { if (!active) throw new DOMException('superseded', 'AbortError'); },
      persist: async () => { active = false; },
      commit: () => { committed = true; },
      markSaved: () => undefined,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(committed).toBe(false);
  });
});
