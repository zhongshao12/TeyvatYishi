import { describe, expect, it } from 'vitest';
import { deriveNarrativeIntimacyFacts } from '@/utils/variableFacts';

/**
 * A2 契约：同一回合同一角色只按**命中的最高档**结算一次。
 * 修复前是「命中第一句就 break」，于是「拥抱…随后亲吻…」只算 +3；
 * 更糟的是「两人发生了性爱关系。」这种**匿名主语**会被整条漏掉（情爱场景最常见的写法）。
 */

const amber = (patch: Record<string, unknown> = {}) => ({
  id: 'npc_amber', 姓名: '安柏', aliases: [], gender: '女', travelingTogether: false, ...patch,
});

const deltaOf = (body: string, records: Array<ReturnType<typeof amber>> = [amber()]) => {
  const derived = deriveNarrativeIntimacyFacts(body, records, { nsfwEnabled: true });
  return derived.find((fact) => fact.type === 'npc')?.affinityDelta ?? 0;
};

describe('亲密事件跨句取最高档', () => {
  it('takes the kiss over an earlier hug', () => {
    expect(deltaOf('安柏紧紧拥抱了旅行者。随后安柏亲吻了旅行者。')).toBe(5);
  });

  it('takes the sex tier over an earlier hand-holding', () => {
    expect(deltaOf('安柏牵起旅行者的手，一路没有松开。当晚安柏与旅行者发生了性爱关系。')).toBe(30);
  });

  it('takes the sex tier when the sex sentence comes first', () => {
    expect(deltaOf('安柏与旅行者发生了性爱关系。事后安柏拥抱了旅行者。')).toBe(30);
  });

  it('still only awards once per turn', () => {
    const derived = deriveNarrativeIntimacyFacts(
      '安柏亲吻了旅行者。之后安柏又亲吻了旅行者。安柏还拥抱了旅行者。',
      [amber()],
      { nsfwEnabled: true },
    );
    expect(derived.filter((fact) => fact.type === 'npc')).toHaveLength(1);
  });
});

describe('匿名主语（两人/彼此）的归属', () => {
  it('attributes to the sole traveling companion', () => {
    expect(deltaOf('两人发生了性爱关系。', [amber({ travelingTogether: true })])).toBe(30);
  });

  it('also picks the higher anonymous tier', () => {
    expect(deltaOf('安柏紧紧拥抱了旅行者。随后两人亲吻了彼此。', [amber({ travelingTogether: true })])).toBe(5);
  });

  it('refuses to attribute when nobody is traveling with the player', () => {
    expect(deltaOf('两人发生了性爱关系。', [amber()])).toBe(0);
  });

  it('refuses to attribute when two companions are traveling', () => {
    const records = [amber({ travelingTogether: true }), { ...amber(), id: 'npc_lisa', 姓名: '丽莎', travelingTogether: true }];
    expect(deltaOf('两人发生了性爱关系。', records)).toBe(0);
  });

  it('never attributes an anonymous sentence to a protected non-adult character', () => {
    expect(deltaOf('两人发生了性爱关系。', [{ ...amber(), 姓名: '可莉', travelingTogether: true }])).toBe(0);
  });

  it('keeps ignoring negated sentences across the whole turn', () => {
    expect(deltaOf('安柏没有亲吻旅行者。安柏也没有拥抱旅行者。', [amber({ travelingTogether: true })])).toBe(0);
  });
});
