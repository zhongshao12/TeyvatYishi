import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import {
  deriveNarrativeClockFact,
  deriveNarrativeTimeFact,
  factsToTeyvatDomainCommands,
} from '@/utils/variableFacts';

describe('fourth user-reported time progression batch', () => {
  it('uses the final explicit clock in the narrative as the settled endpoint', () => {
    expect(deriveNarrativeClockFact(
      '上午十点，旅行者从蒙德城出发。经过一整天的调查，晚上八点回到猎鹿人餐馆。',
      '09:40',
    )).toMatchObject({ mode: 'set_time', targetTime: '20:00' });
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

  it('applies a small forward step when a normal narrative turn contains no clock phrase', () => {
    expect(deriveNarrativeTimeFact(
      '安柏认真回答了旅行者的问题，两人随后继续商量侦察路线。',
      '10:00',
    )).toMatchObject({ mode: 'elapsed', minutes: 3 });
  });

  it('replaces a contradictory same-day backward clock with a minimal forward step', () => {
    expect(deriveNarrativeTimeFact(
      '此时上午九点，安柏仍在城门口等待。',
      '10:00',
    )).toMatchObject({ mode: 'elapsed', minutes: 3 });
  });
});
