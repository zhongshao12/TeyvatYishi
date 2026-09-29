import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { factsToTeyvatDomainCommands, resolveTurnTimeFact } from '@/utils/variableFacts';

describe('single turn time decision', () => {
  it('advances exactly three dates and travel days for a three-day narrative jump', () => {
    const decision = resolveTurnTimeFact('三天后，队伍抵达营地。', '23:30');
    expect(decision).toMatchObject({ fact: { mode: 'next_day', days: 3 }, warning: null });
    const state = createEmptyTeyvatGameState();
    state.世界.当前日期 = '旅行历 1000.03.07';
    state.世界.当前时间 = '23:30';
    state.世界.旅程天数 = 1;
    const commands = factsToTeyvatDomainCommands([decision.fact!, decision.fact!], state, 2).commands;
    expect(commands.filter((command) => command.path === '旅程天数')).toEqual([
      expect.objectContaining({ action: 'add', value: 3 }),
    ]);
    expect(commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '当前日期', value: '旅行历 1000.03.10' }),
    ]));
  });

  it('does not fabricate progress when an explicit same-day clock goes backward', () => {
    expect(resolveTurnTimeFact('此时上午九点，安柏仍在城门口等待。', '10:00')).toEqual({
      fact: null,
      warning: expect.stringContaining('回退'),
    });
  });

  it('uses a short elapsed step only when no time evidence exists', () => {
    expect(resolveTurnTimeFact('安柏和旅行者商量了侦察路线。', '10:00')).toMatchObject({
      fact: { mode: 'elapsed', minutes: 3 }, warning: null,
    });
  });

  it('lets explicit narrative evidence override a contradictory model fact', () => {
    expect(resolveTurnTimeFact('三天后，众人在清晨六点抵达。', '23:30', {
      type: 'time', mode: 'set_time', targetTime: '22:00', evidence: '模型推测',
    })).toMatchObject({ fact: { mode: 'next_day', days: 3, targetTime: '06:00' }, warning: null });
  });

  it('uses a later multi-day marker instead of an earlier clock', () => {
    expect(resolveTurnTimeFact('现在是上午十点。三天后，队伍终于抵达营地。', '09:00'))
      .toMatchObject({ fact: { mode: 'next_day', days: 3 }, warning: null });
  });

  it('rejects a malformed explicit clock instead of applying default elapsed time', () => {
    expect(resolveTurnTimeFact('钟楼显示现在是 25:70。', '10:00'))
      .toEqual({ fact: null, warning: expect.stringContaining('无效') });
  });
});
