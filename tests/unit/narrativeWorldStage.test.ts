import { describe, expect, it } from 'vitest';
import { applyNarrativeWorldStage } from '../../hooks/useGame/narrativeWorldStage';
import { 创建空角色 } from '../../models/character';
import { 创建空世界状态 } from '../../models/world';

describe('narrativeWorldStage', () => {
  it('settles world facts and the response weather without mutating the starting world', () => {
    const world = {
      ...创建空世界状态(),
      当前地点: '蒙德城',
      当前天气: 'clear',
      全局事件: ['风花节临近'],
    };

    const traveler = 创建空角色();
    const settled = applyNarrativeWorldStage({
      world,
      traveler,
      factCandidates: [
        { domain: 'world', fact: '风魔龙掠过城墙', evidence: '巨龙的影子掠过高墙。' },
        { domain: 'character', fact: '安柏握紧弓弦', evidence: '安柏举起猎弓。' },
        { domain: 'location', fact: '众人抵达蒙德城门', evidence: '城门就在眼前。' },
      ],
      rawResponseText: '细雪落上石板。\n<天气>雪</天气>',
    });

    expect(settled.world.全局事件).toEqual([
      '风花节临近',
      '风魔龙掠过城墙',
      '众人抵达蒙德城门',
    ]);
    expect(settled.world.当前天气).toBe('snow');
    expect(settled.worldFacts).toEqual(['风魔龙掠过城墙', '众人抵达蒙德城门']);
    expect(settled.traveler).toBe(traveler);
    expect(world.全局事件).toEqual(['风花节临近']);
    expect(world.当前天气).toBe('clear');
  });
});
