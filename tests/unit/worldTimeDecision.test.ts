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

  it('does not advance when the narrative explicitly keeps the current clock', () => {
    expect(resolveTurnTimeFact('钟楼显示现在是 10:00。', '10:00'))
      .toEqual({ fact: null, warning: null });
  });

  it('advances an eight-day jump as eight days instead of silently advancing only three minutes or changing the same-day clock', () => {
    // 2026-09-29 契约修订（用户第二轮报「时间推进有问题」）：
    // 旧实现把正文跨日**一律**收紧在 7 天内，于是「八天后」「半个月后」「一个月后」被整条拦下，
    // 而「数日后」又落到凭空 +3 分钟 —— 两种情况玩家看到的都是「时间没推进」。
    // 规格只要求「同日回退要拦、不得凭空编造耗时」，并未给正文跨度设 7 天上限；
    // 因此正文跨度放宽到 365 天（超限仍拦下并给出可查原因），模型自报的跨度仍收紧在 7 天内。
    const first = resolveTurnTimeFact('八天后，队伍抵达营地。', '10:00');
    const second = resolveTurnTimeFact('八天后，队伍在 15:00 抵达营地。', '10:00');
    expect(first.fact?.mode).toBe('next_day');
    expect((first.fact as { days?: number } | null)?.days).toBe(8);
    expect(first.fact?.targetTime).toBe('10:00');
    expect(first.warning).toBeNull();
    // 同一句里出现的 15:00 不得把跨日退化成「当日改钟点」。
    expect(second.fact?.mode).toBe('next_day');
    expect((second.fact as { days?: number } | null)?.days).toBe(8);
  });
});
