import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { captureWorldMoment } from '@/services/worldMoment';
import { resolveSteambirdRetryContext } from '@/hooks/useGame/sendWorkflow';

describe('manual Steambird retry time', () => {
  it('uses the failed task turn and its frozen moment after the world advances', () => {
    const game = createEmptyTeyvatGameState();
    game.turnCount = 3;
    game.世界.当前时间 = '14:00';
    const turnTwo = captureWorldMoment(game.世界, 2, 'settlement-2');
    game.世界.当前时间 = '18:00';
    game.叙事.lastCommittedMoment = captureWorldMoment(game.世界, 3, 'settlement-3');
    game.叙事.variableBatches = [{
      id: 'vbatch_settlement-2', turn: 2, timestamp: 100, source: 'main',
      results: [], worldMoment: turnTwo,
    }];
    expect(resolveSteambirdRetryContext(game, { turn: 2 })).toEqual({ turn: 2, worldMoment: turnTwo });
  });
});
