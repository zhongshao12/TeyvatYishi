import { describe, expect, it } from 'vitest';

import {
  归一化开局档案,
  归一化世界状态,
  创建空世界状态,
  对齐世界日期与天数,
  推进旅行日期,
  解析旅行日期序数,
  默认旅行日期,
} from '@/models/world';
import { applyVariableCommand } from '@/utils/variableExecutor';

describe('旧存档 → 提瓦特纪年兼容层', () => {
  it('默认纪年是旅行纪年，默认日期是旅行历', () => {
    const world = 创建空世界状态();
    expect(world.纪年法).toBe('旅行纪年');
    expect(world.旅程天数).toBe(1);
    expect(默认旅行日期).toBe('旅行历 1000.03.07');
  });

  it('旧存档的「开拓天数」字段被读入「旅程天数」且旧键被剥除', () => {
    const legacy = {
      纪年法: '琥珀纪年',
      开拓天数: 4,
      当前日期: '琥珀纪 2157.03.10',
    } as never;
    const world = 归一化世界状态(legacy);
    expect(world.旅程天数).toBe(4);
    expect(world.当前日期).toBe('旅行历 1000.03.10');
    expect((world as unknown as Record<string, unknown>).开拓天数).toBeUndefined();
    expect(world.纪年法).toBe('琥珀纪年'); // 已保存的纪年名保留，仅默认值换新
  });

  it('新格式日期与天数对齐保持一致', () => {
    const aligned = 对齐世界日期与天数(3, '旅行历 1000.03.09');
    expect(aligned.旅程天数).toBe(3);
    expect(aligned.当前日期).toBe('旅行历 1000.03.09');
  });

  it('日期解析同时接受旅行历与旧琥珀纪，序数一致', () => {
    expect(解析旅行日期序数('旅行历 1000.03.07')).toBe(解析旅行日期序数('琥珀纪 2157.03.07'));
    expect(解析旅行日期序数('旅行历 1000.03.08')).toBe(解析旅行日期序数('琥珀纪 2157.03.07')! + 1);
  });

  it('推进旅行日期输出旅行历格式', () => {
    expect(推进旅行日期('琥珀纪 2157.03.07', 1)).toBe('旅行历 1000.03.08');
  });

  it('变量命令：旧协议键「世界.开拓天数」被改写到新字段', () => {
    const world = 创建空世界状态();
    const state = { 世界: world } as never;
    let captured: unknown;
    const setters = {
      set世界: (updater: (prev: unknown) => unknown) => { captured = updater(world); },
    } as never;
    const result = applyVariableCommand(
      { key: '世界.开拓天数', action: 'add', value: 1 } as never,
      state,
      setters,
    );
    expect(result.ok).not.toBe(false);
    const nextWorld = captured as ReturnType<typeof 创建空世界状态>;
    expect(nextWorld.旅程天数).toBe(2);
    expect((nextWorld as unknown as Record<string, unknown>).开拓天数).toBeUndefined();
  });
});

describe('旧存档 → 开局档案地点字段兼容层', () => {
  it('旧存档的「星球来源」字段被读入「地点来源」', () => {
    const legacy = {
      来源: 'free',
      星球来源: 'custom',
      地区ID: 'mondstadt',
      地区名称: '蒙德',
      章节锚点ID: 'mondstadt_dragon_incident',
      章节锚点名称: '蒙德 · 风魔龙之影',
      章节参考说明: '背景参考。',
      玩家介入原文: '',
      防回退规则: [],
    } as never;
    const archive = 归一化开局档案(legacy);
    expect(archive.地点来源).toBe('custom');
    expect((archive as unknown as Record<string, unknown>).星球来源).toBeUndefined();
  });

  it('旧整理档案的「自定义星球/星球简介」被读入新字段且旧键被剥除', () => {
    const legacy = {
      来源: 'free',
      地点来源: 'custom',
      地区ID: 'mondstadt',
      地区名称: '蒙德',
      章节锚点ID: 'mondstadt_dragon_incident',
      章节锚点名称: '蒙德 · 风魔龙之影',
      章节参考说明: '背景参考。',
      玩家介入原文: '',
      整理档案: {
        自定义星球: '试作璃月港',
        星球简介: '依山傍海的港口聚落。',
      },
      防回退规则: [],
    } as never;
    const archive = 归一化开局档案(legacy);
    expect(archive.整理档案?.自定义地点).toBe('试作璃月港');
    expect(archive.整理档案?.地点简介).toBe('依山傍海的港口聚落。');
    const summaryRecord = archive.整理档案 as unknown as Record<string, unknown>;
    expect(summaryRecord.自定义星球).toBeUndefined();
    expect(summaryRecord.星球简介).toBeUndefined();
  });

  it('新字段与旧自由度模式同时缺省时回退默认地点来源', () => {
    const archive = 归一化开局档案({ 来源: 'free', 防回退规则: [] } as never);
    expect(archive.地点来源).toBe('existing');
  });
});
