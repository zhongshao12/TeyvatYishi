import { describe, expect, it } from 'vitest';

import {
  applyElementToField,
  buildElementalFieldPromptSection,
  createEmptyElementalField,
  detectAppliedElements,
  detectTravelerAppliedElements,
  resolveReaction,
} from '@/models/teyvat/elementalGauge';
import {
  canTeleportTo,
  createEmptyTeyvatMapState,
  markTeleport,
  normalizeTeyvatMapState,
  unlockStatue,
} from '@/models/teyvat/map';

describe('G1 元素附着与反应（极简版）', () => {
  it('从正文检测元素应用并去重', () => {
    expect(detectAppliedElements('他挥出火元素的烈焰，随后水元素涌上。')).toEqual(['pyro', 'hydro']);
    expect(detectAppliedElements('没有任何元素描述。')).toEqual([]);
  });

  it('无附着时直接附着，不产生事件', () => {
    const outcome = applyElementToField(createEmptyElementalField(), 'pyro', 1);
    expect(outcome.field.auraElement).toBe('pyro');
    expect(outcome.events).toHaveLength(0);
  });

  it('同元素重复应用：附着保持，不触发反应', () => {
    const first = applyElementToField(createEmptyElementalField(), 'pyro', 1);
    const second = applyElementToField(first.field, 'pyro', 2);
    expect(second.field.auraElement).toBe('pyro');
    expect(second.events).toHaveLength(0);
    expect(second.field.updatedTurn).toBe(2);
  });

  it('火附着遇水：触发蒸发并记录事件，附着易主为水', () => {
    const first = applyElementToField(createEmptyElementalField(), 'pyro', 1);
    const second = applyElementToField(first.field, 'hydro', 2);
    expect(second.events).toHaveLength(1);
    expect(second.events[0].name).toBe('蒸发');
    expect(second.events[0].turn).toBe(2);
    expect(second.field.auraElement).toBe('hydro');
  });

  it('无反应的不同元素：覆盖附着且不记事件', () => {
    const first = applyElementToField(createEmptyElementalField(), 'cryo', 1);
    const second = applyElementToField(first.field, 'dendro', 2);
    expect(second.events).toHaveLength(0);
    expect(second.field.auraElement).toBe('dendro');
  });

  it('风元素对任意附着触发扩散', () => {
    const first = applyElementToField(createEmptyElementalField(), 'electro', 1);
    const second = applyElementToField(first.field, 'anemo', 2);
    expect(second.events[0].name).toContain('扩散');
  });

  it('岩元素对任意附着触发结晶', () => {
    expect(resolveReaction('hydro', 'geo')?.name).toBe('水结晶');
  });

  it('提示词段落包含附着与最近反应', () => {
    const first = applyElementToField(createEmptyElementalField(), 'pyro', 1);
    const second = applyElementToField(first.field, 'hydro', 2);
    const section = buildElementalFieldPromptSection(second.field, second.events);
    expect(section).toContain('场面元素状态');
    expect(section).toContain('水元素');
    expect(section).toContain('蒸发');
    expect(buildElementalFieldPromptSection(createEmptyElementalField(), [])).toBe('');
  });
});

describe('熟练度主语过滤（只记旅行者本人施放的元素）', () => {
  const names = ['荧', '旅行者'];

  it('旅行者对白行：计入', () => {
    const body = '【荧】：「以火元素之名，斩开荆棘！」';
    expect(detectTravelerAppliedElements(body, names)).toEqual(['pyro']);
  });

  it('其他角色对白行：不计入', () => {
    const body = '【深渊法师】：「尝尝雷元素的滋味吧！」';
    expect(detectTravelerAppliedElements(body, names)).toEqual([]);
  });

  it('旁白行提及旅行者：计入；仅描述敌人：不计入', () => {
    const mentioned = '【旁白】荧凝聚水元素，向遗迹守卫冲去。';
    expect(detectTravelerAppliedElements(mentioned, names)).toEqual(['hydro']);
    const enemyOnly = '【旁白】遗迹守卫周身环绕冰元素寒气。';
    expect(detectTravelerAppliedElements(enemyOnly, names)).toEqual([]);
  });

  it('【角色】行解析真实说话人：旅行者计入，敌人不计入', () => {
    expect(detectTravelerAppliedElements('【角色】荧：风元素，扩散！', names)).toEqual(['anemo']);
    expect(detectTravelerAppliedElements('【角色】丘丘人：火元素攻击！', names)).toEqual([]);
  });

  it('混合正文只收旅行者相关的元素并去重', () => {
    const body = [
      '【旁白】敌人掀起冰元素风暴。',
      '【荧】：「火元素，燃烧吧！」',
      '【旁白】荧把火元素聚在剑尖。',
    ].join('\n');
    expect(detectTravelerAppliedElements(body, names)).toEqual(['pyro']);
  });
});

describe('G2 地图与传送', () => {
  it('开局仅蒙德神像激活', () => {
    const map = createEmptyTeyvatMapState();
    expect(canTeleportTo(map, 'mondstadt')).toBe(true);
    expect(canTeleportTo(map, 'liyue')).toBe(false);
  });

  it('标记神像后可传送，重复标记幂等', () => {
    let map = createEmptyTeyvatMapState();
    map = unlockStatue(map, 'liyue');
    map = unlockStatue(map, 'liyue');
    expect(canTeleportTo(map, 'liyue')).toBe(true);
    expect(map.unlockedStatues).toHaveLength(2);
  });

  it('旧存档缺地图字段时回退默认值', () => {
    const normalized = normalizeTeyvatMapState({});
    expect(normalized.unlockedStatues).toEqual(['mondstadt']);
    const marked = markTeleport(normalized, 5);
    expect(marked.lastTeleportTurn).toBe(5);
  });
});
