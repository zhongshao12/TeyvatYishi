import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import {
  deriveNarrativeClockFact,
  deriveNarrativeTimeFact,
  factsToTeyvatDomainCommands,
  resolveTurnTimeFact,
} from '@/utils/variableFacts';

describe('fourth user-reported time progression batch', () => {
  it('uses the final explicit clock in the narrative as the settled endpoint', () => {
    // 契约修订（2026-10-03，第 3 批 B10）：正文里两个钟点之间的**当天差值**现在也算进跨度
    // （09:40 → 上午十点 = +20 分钟，→ 晚上八点 = +600 分钟）。
    // 终点仍然是最后写出的那个钟点（20:00），这一点与旧契约一致。
    const fact = deriveNarrativeClockFact(
      '上午十点，旅行者从蒙德城出发。经过一整天的调查，晚上八点回到猎鹿人餐馆。',
      '09:40',
    );
    expect(fact?.mode).toBe('elapsed');
    expect(fact?.minutes).toBe(620);
    expect(fact?.targetTime).toBeUndefined();
    // 落到命令层后，目标时刻仍然是「最后写出的钟点」。
    const state = createEmptyTeyvatGameState();
    state.世界.当前时间 = '09:40';
    const commands = factsToTeyvatDomainCommands([fact!], state, 2).commands;
    expect(commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ root: '世界', path: '当前时间', action: 'set', value: '20:00' }),
    ]));
  });

  it('keeps a second-day marker even when it is far from the final clock text', () => {
    expect(deriveNarrativeClockFact(
      '第二天，众人整理好行装并沿着长长的山路重新出发，抵达营地时已经是早上八点。',
      '20:00',
    )).toMatchObject({ mode: 'next_day', targetTime: '08:00' });
  });

  it('recognizes an explicit several-hour narrative jump', () => {
    expect(deriveNarrativeClockFact(
      '三个小时后，风龙废墟的调查终于告一段落。',
      '19:30',
    )).toMatchObject({ mode: 'elapsed', minutes: 180 });
  });

  it('advances date, day count, and clock together when elapsed time crosses midnight', () => {
    const state = createEmptyTeyvatGameState();
    state.世界.当前日期 = '旅行历 1000.03.07';
    state.世界.当前时间 = '22:30';
    state.世界.旅程天数 = 1;
    const result = factsToTeyvatDomainCommands([{
      type: 'time', mode: 'elapsed', minutes: 180, evidence: '三个小时后，调查终于结束。',
    }], state, 2);
    expect(result.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ root: '世界', path: '旅程天数', action: 'add', value: 1 }),
      expect.objectContaining({ root: '世界', path: '当前日期', action: 'set', value: '旅行历 1000.03.08' }),
      expect.objectContaining({ root: '世界', path: '当前时间', action: 'set', value: '01:30' }),
    ]));
  });

  it('treats an explicit second-day set_time as a date jump even when its clock is later', () => {
    const state = createEmptyTeyvatGameState();
    state.世界.当前日期 = '旅行历 1000.03.07';
    state.世界.当前时间 = '06:00';
    state.世界.旅程天数 = 1;
    const result = factsToTeyvatDomainCommands([{
      type: 'time', mode: 'set_time', targetTime: '08:00', evidence: '第二天早上八点，众人再次出发。',
    }], state, 2);
    expect(result.commands).toEqual(expect.arrayContaining([
      expect.objectContaining({ root: '世界', path: '旅程天数', action: 'add', value: 1 }),
      expect.objectContaining({ root: '世界', path: '当前日期', action: 'set', value: '旅行历 1000.03.08' }),
      expect.objectContaining({ root: '世界', path: '当前时间', action: 'set', value: '08:00' }),
    ]));
  });

  it('applies the configured minimum step when a normal narrative turn contains no clock phrase', () => {
    // 契约修订（2026-10-03 第三轮）：兜底推进改为设置项「最小推进步长」，下限 15 分钟。
    expect(deriveNarrativeTimeFact(
      '安柏认真回答了旅行者的问题，两人随后继续商量侦察路线。',
      '10:00',
    )).toMatchObject({ mode: 'elapsed', minutes: 15 });
  });

  it('never puts a contradictory same-day backward clock into the state', () => {
    // 契约修订（2026-10-03）：回溯式钟点（09:00 < 当前 10:00）不再入账，也不会被加成 +1440 绕圈；
    // 正文同时「声明了当前钟点」时按声明处理（该回合不推进），并在诊断里写明「不倒退」。
    const fact = deriveNarrativeTimeFact('此时上午九点，安柏仍在城门口等待。', '10:00');
    expect(fact).toBeNull();
    expect(fact?.mode).not.toBe('set_time');
    const decided = resolveTurnTimeFact('此时上午九点，安柏仍在城门口等待。', '10:00');
    expect(decided.warning).toContain('不倒退');
  });
});
