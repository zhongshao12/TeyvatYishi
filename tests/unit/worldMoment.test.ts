import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatWorld } from '@/models/teyvat/world';
import { captureWorldMoment, normalizeWorldMoment } from '@/services/worldMoment';

describe('committed world moment', () => {
  it('captures an immutable snapshot of the game-world clock and place', () => {
    const world = createEmptyTeyvatWorld();
    world.当前日期 = '旅行历 1000.03.07';
    world.当前时间 = '10:00';
    world.当前天气 = '晴';
    world.当前地点 = '蒙德城';
    world.旅程天数 = 7;

    const moment = captureWorldMoment(world, 12, 'settlement-12');
    world.当前时间 = '18:00';
    world.当前天气 = '雨';

    expect(moment).toEqual({
      worldName: '提瓦特', date: '旅行历 1000.03.07', clock: '10:00',
      weather: '晴', location: '蒙德城', travelDay: 7,
      turn: 12, settlementId: 'settlement-12',
    });
    expect(Object.isFrozen(moment)).toBe(true);
    expect(JSON.parse(JSON.stringify(moment))).toEqual(moment);
  });

  it('leaves absent historical provenance unknown', () => {
    expect(normalizeWorldMoment({
      date: '旅行历 1000.03.07', clock: '10:00', turn: 12, settlementId: 'settlement-12',
    })).toEqual({
      worldName: '提瓦特', date: '旅行历 1000.03.07', clock: '10:00',
      weather: null, location: null, travelDay: null,
      turn: 12, settlementId: 'settlement-12',
    });
  });

  it('rejects records with no stable turn and settlement identity', () => {
    const world = createEmptyTeyvatWorld();
    expect(() => captureWorldMoment(world, -1, 'settlement')).toThrow();
    expect(() => captureWorldMoment(world, 1, ' ')).toThrow();
    expect(normalizeWorldMoment({ turn: 0, settlementId: '' })).toBeNull();
  });
});
