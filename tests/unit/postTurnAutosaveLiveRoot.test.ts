import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState, type TeyvatGameState, type TeyvatSaveData } from '@/models/teyvat';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import * as autoSaveStage from '@/hooks/useGame/autoSaveStage';

describe('post-turn autosave root', () => {
  it('persists a panel edit made while background tasks were running', () => {
    const stale = createEmptyTeyvatGameState();
    stale.turnCount = 1;
    let live = normalizeTeyvatGameState({
      ...stale,
      turnCount: 2,
      背包: { ...stale.背包, mora: 999 },
      世界: { ...stale.世界, 当前地点: '蒙德城' },
    });
    const state = {
      game: stale,
      chatHistory: [],
      variableBatches: [],
      updateGameState: (updater: (current: TeyvatGameState) => TeyvatGameState) => { live = updater(live); },
    } as unknown as UseGameStateReturn;
    const builder = (autoSaveStage as { buildPostTurnAutosavePayload?: (state: UseGameStateReturn) => TeyvatSaveData })
      .buildPostTurnAutosavePayload;
    expect(builder).toBeTypeOf('function');

    const payload = builder!(state);
    expect(payload.turnCount).toBe(2);
    expect(payload.背包.mora).toBe(999);
    expect(payload.世界.当前地点).toBe('蒙德城');
  });
});
