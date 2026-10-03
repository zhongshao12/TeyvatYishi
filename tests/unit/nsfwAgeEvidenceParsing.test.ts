import { describe, expect, it } from 'vitest';
import { getAdultAgeEvidenceReason, getMinorAgeEvidenceReason, getNsfwArchiveBlockReason } from '@/utils/nsfwArchivePolicy';
import { resolveNpcAdultEligibility } from '@/utils/npcAdultEligibility';

/**
 * P1-B09：年龄识别漏掉「周岁」，也会误挡二十多岁的角色。
 *
 * 复现（审查者元数据探针）：
 * - `17周岁`、`十七周岁` **没有**被未成年证据规则拦下 → 随后「未知年龄放行」返回 confirmed=true；
 * - `二十四岁`、`二十七岁` 因 `十四`/`十七` **子串**误判为未成年。
 *
 * 修法：完整解析「数字/中文数字 + 可选『周』 + 岁」，整词匹配，禁止任意子串；
 * 并明确「成年确认」与「年龄未知」的边界 —— 未检出未成年词不等于可信成年证据。
 * 本文件只用年龄与身份元数据，不需要任何成人场景素材。
 */

const 未成年文本 = [
  '7岁',
  '7周岁',
  '七岁',
  '七周岁',
  '17岁',
  '17周岁',
  '十七岁',
  '十七周岁',
  '十岁的学徒，常在城门口等姐姐回家。',
  '看上去只有十二三岁。',
  '尚未成年的见习修女。',
  '小学三年级的学生。',
  '初中生。',
  '未满十八岁。',
  '未满18周岁。',
  '未成年。',
];

/** 「未满二十岁」这类边界：可能是 19 岁的成年人，不能一律当未成年拦下。 */
const 年龄未知文本 = [
  '未满二十岁。',
  '未满二十五周岁。',
];

const 成年文本 = [
  '18岁',
  '18周岁',
  '十八岁',
  '十八周岁',
  '20岁的冒险家。',
  '24岁',
  '二十四岁',
  '27岁',
  '二十七岁',
  '三十七岁',
  '四十四岁',
  '一百零八岁',
  '成年女性，稻妻的巫女。',
  '西风骑士团图书管理员。',
  '身材高挑，穿着骑士团制服。',
];

describe('B09 年龄证据必须整词解析（禁止子串匹配）', () => {
  for (const text of 未成年文本) {
    it(`未成年证据：${text}`, () => {
      expect(getMinorAgeEvidenceReason(undefined, '小满', text)).not.toBeNull();
      expect(getNsfwArchiveBlockReason(undefined, '小满', text)).not.toBeNull();
    });
  }

  for (const text of 成年文本) {
    it(`不得误判为未成年：${text}`, () => {
      expect(getMinorAgeEvidenceReason(undefined, '原创角色', text)).toBeNull();
      expect(getNsfwArchiveBlockReason(undefined, '原创角色', text)).toBeNull();
    });
  }

  it('「十七」/「十四」的子串不得污染二十多岁的年龄', () => {
    // 这两条是审查者给出的具体误判：二十七岁含「十七」、二十四岁含「十四」。
    expect(getMinorAgeEvidenceReason(undefined, '原创角色', '二十七岁的佣兵队长。')).toBeNull();
    expect(getMinorAgeEvidenceReason(undefined, '原创角色', '二十四岁的佣兵队长。')).toBeNull();
    // 反过来，真的十七岁/十四岁仍然要拦。
    expect(getMinorAgeEvidenceReason(undefined, '原创角色', '十七岁的见习骑士。')).not.toBeNull();
    expect(getMinorAgeEvidenceReason(undefined, '原创角色', '十四岁的学徒。')).not.toBeNull();
  });

  it('同时出现成年与未成年证据时按未成年处理（冲突证据取更保守的一侧）', () => {
    expect(getNsfwArchiveBlockReason(undefined, '原创角色', '自称二十四岁，其实是十七周岁。')).not.toBeNull();
  });

  it('「周岁」与「岁」两种写法同判', () => {
    expect(getMinorAgeEvidenceReason(undefined, '原创角色', '十七周岁')).not.toBeNull();
    expect(getMinorAgeEvidenceReason(undefined, '原创角色', '十七岁')).not.toBeNull();
    expect(getMinorAgeEvidenceReason(undefined, '原创角色', '二十七周岁')).toBeNull();
    expect(getMinorAgeEvidenceReason(undefined, '原创角色', '二十七岁')).toBeNull();
  });

  for (const text of 年龄未知文本) {
    it(`未满N岁且 N>18 不当作未成年证据：${text}`, () => {
      expect(getMinorAgeEvidenceReason(undefined, '原创角色', text)).toBeNull();
      expect(getNsfwArchiveBlockReason(undefined, '原创角色', text)).toBeNull();
    });
  }
});

describe('B09 成年确认与年龄未知的边界', () => {
  it('明确成年年龄会给出可信的成年证据理由', () => {
    const reason = getAdultAgeEvidenceReason(undefined, '原创角色', '二十四岁的佣兵队长。');
    expect(reason).not.toBeNull();
    expect(reason).toContain('24');
    expect(getAdultAgeEvidenceReason(undefined, '原创角色', '二十七周岁')).not.toBeNull();
    expect(getAdultAgeEvidenceReason(undefined, '原创角色', '18岁')).not.toBeNull();
  });

  it('没有年龄信息时不得声称「成年已确认」', () => {
    expect(getAdultAgeEvidenceReason(undefined, '原创角色', '西风骑士团图书管理员。')).toBeNull();
    expect(getAdultAgeEvidenceReason(undefined, '原创角色', '')).toBeNull();
  });

  it('十七周岁的角色即使被手工标为成年也不得放行（冲突证据）', () => {
    expect(resolveNpcAdultEligibility({
      name: '原创冒险家', description: '十七周岁', ageConfirmation: 'adult', ageSource: 'manual',
    }).confirmed).toBe(false);
    expect(resolveNpcAdultEligibility({
      name: '原创冒险家', description: '17周岁', ageConfirmation: 'adult', ageSource: 'manual',
    }).confirmed).toBe(false);
    expect(resolveNpcAdultEligibility({
      name: '原创冒险家', description: '十七岁', ageConfirmation: 'adult', ageSource: 'canonical', canonicalBaselineAge: 'adult',
    }).confirmed).toBe(false);
  });

  it('二十多岁的角色正常放行，且理由说明来自明确年龄', () => {
    const result = resolveNpcAdultEligibility({ name: '原创冒险家', description: '二十四岁的佣兵队长。' });
    expect(result.confirmed).toBe(true);
    expect(result.reason).toContain('24');
  });

  it('年龄未知仍然放行（既有放宽契约），但理由不把「没查到未成年词」说成成年证据', () => {
    const result = resolveNpcAdultEligibility({ name: '原创冒险家', description: '西风骑士团图书管理员。' });
    expect(result.confirmed).toBe(true);
    expect(result.reason).toContain('年龄未知');
    expect(result.reason).not.toContain('成年已确认');
  });

  it('受保护身份与原著成年基线不受影响', () => {
    expect(resolveNpcAdultEligibility({ name: '可莉', ageConfirmation: 'adult', ageSource: 'manual' }).confirmed).toBe(false);
    expect(resolveNpcAdultEligibility({ name: '安柏', canonicalBaselineAge: 'adult' }).confirmed).toBe(true);
  });
});
