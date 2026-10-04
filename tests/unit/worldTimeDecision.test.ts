import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { describeTimeDecision, factsToTeyvatDomainCommands, resolveTurnTimeFact } from '@/utils/variableFacts';

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
    // 契约修订（2026-10-03，第 3 批 B10）：多段相对时间改为按叙事顺序累计跨度，
    // 「现在的钟点 + 三天后」= 三天。日期 / 旅行天数 / 同行奖励与旧的 next_day 语义完全一致，
    // 因此这里断言**同一个结果**（3 天整），只把表达方式从 next_day 换成累计跨度。
    const decided = resolveTurnTimeFact('现在是上午十点。三天后，队伍终于抵达营地。', '09:00');
    expect(decided.warning).toBeNull();
    const days = decided.fact?.mode === 'next_day'
      ? decided.fact.days
      : Math.floor((decided.fact?.minutes ?? 0) / 1440);
    expect(days).toBe(3);
    expect(decided.fact?.targetTime === undefined || decided.fact?.targetTime === '10:00').toBe(true);
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

// 「时间没有正常推进」（2026-10-03 玩家实测，预设激活后整场戏时间一动不动）。
// 变量模型在「短对话 / 原地互动」场景会持续回 no_change，而旧实现让 no_change 直接冻结时钟。
describe('explicit no_change no longer freezes the clock', () => {
  const noChange = { type: 'time', mode: 'no_change', evidence: '模型判定本回合无耗时' } as const;

  it('模型判定 no_change 时仍按最小耗时推进（与「没有耗时证据」同一策略）', () => {
    expect(resolveTurnTimeFact('两人说了几句话。', '10:00', noChange as never)).toMatchObject({
      fact: { mode: 'elapsed', minutes: 3 }, warning: null,
    });
  });

  it('正文明确声明了当前钟点时仍然不推进（故事自己说时间没变）', () => {
    expect(resolveTurnTimeFact('钟楼显示现在是 10:00。', '10:00', noChange as never))
      .toEqual({ fact: null, warning: null });
  });

  it('正文写出耗时证据时照常按证据推进（no_change 不得压过正文）', () => {
    expect(resolveTurnTimeFact('两个小时后，队伍抵达营地。', '10:00', noChange as never)).toMatchObject({
      fact: { mode: 'elapsed', minutes: 120 }, warning: null,
    });
  });

  it('模型给出真实时间事实时依旧以模型为准', () => {
    expect(resolveTurnTimeFact('队伍休整。', '10:00', {
      type: 'time', mode: 'elapsed', minutes: 45, evidence: '模型判定休整耗时',
    } as never)).toMatchObject({ fact: { mode: 'elapsed', minutes: 45 } });
  });
});

describe('time decision summary for the settlement report', () => {
  it('把推进量与原因写成人话', () => {
    expect(describeTimeDecision(resolveTurnTimeFact('两人说了几句话。', '10:00'), '10:00'))
      .toContain('推进 3 分钟');
    expect(describeTimeDecision(resolveTurnTimeFact('钟楼显示现在是 10:00。', '10:00'), '10:00'))
      .toContain('时间未推进');
    expect(describeTimeDecision(resolveTurnTimeFact('三天后，队伍抵达营地。', '23:30'), '23:30'))
      .toContain('跨日 3 天');
    expect(describeTimeDecision({ fact: null, warning: '同日时间回退：当前 10:00，正文目标 09:00；时间未推进。' }, '10:00'))
      .toContain('回退');
  });
});
