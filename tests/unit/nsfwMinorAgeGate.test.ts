import { describe, expect, it } from 'vitest';
import { matchCanonical } from '@/data/canonicalCharacters';
import { getMinorAgeEvidenceReason, getNsfwArchiveBlockReason } from '@/utils/nsfwArchivePolicy';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';
import { deriveNarrativeIntimacyFacts } from '@/utils/variableFacts';
import type { NPC记录 } from '@/models/npc';

/**
 * S1：自定义非成年角色必须被拦住。
 *
 * 两条同样重要的断言方向：
 * 1) 「十岁的学徒」这类**自定义**角色要被拦（此前完全没闸门 → 被默认标成年 + 处女 + 性爱 +30）；
 * 2) **不能误伤原著成年女性**：实测 `少女` 出现在 17/58 个成年角色的外貌里（安柏/甘雨/刻晴…），
 *    所以词表必须收窄到明确未成年表述。第 2 条是防止"修一个洞、炸一片"。
 */

const legacy = (patch: Partial<NPC记录> & { id: string; 姓名: string }): NPC记录 => ({
  阶位: 'companion', 好感度: 0, 关系: 'stranger', 亲密关系: false, 同行: false,
  初见回合: 1, 最近回合: 1, 备注: [], ...patch,
} as NPC记录);

describe('未成年年龄证据判定', () => {
  it.each([
    ['十岁的学徒，常在城门口等姐姐回家。'],
    ['看上去只有十二三岁。'],
    ['尚未成年的见习修女。'],
    ['小学三年级的学生。'],
    ['17岁的少年。'],
    ['未满18岁。'],
  ])('detects minor evidence in %s', (text) => {
    expect(getMinorAgeEvidenceReason(undefined, '小满', text)).not.toBeNull();
  });

  it.each([
    ['西风骑士团图书管理员。'],
    ['十八岁，骑士团书记官。'],
    ['20岁的冒险家。'],
    ['成年女性，稻妻的巫女。'],
  ])('does not flag %s', (text) => {
    expect(getMinorAgeEvidenceReason(undefined, '原创角色', text)).toBeNull();
  });

  it('never flags canonical adults whose appearance says 少女', () => {
    // 这条是防误伤的护栏：这 17 个外貌都含「少女/幼小」等词，但她们是成年角色。
    const females = ['安柏', '甘雨', '刻晴', '胡桃', '香菱', '神里绫华', '宵宫', '珊瑚宫心海', '柯莱', '妮露', '琳妮特', '夏洛蒂', '娜维娅', '玛拉妮', '菲谢尔', '荧'];
    for (const name of females) {
      const canonical = matchCanonical(name);
      expect(canonical?.appearance, `${name} 应当有外貌`).toBeTruthy();
      expect(
        getNsfwArchiveBlockReason(undefined, name, canonical?.appearance ?? ''),
        `${name} 不得因为外貌里有「少女」而被拦住`,
      ).toBeNull();
    }
  });

  it('still blocks the canonical non-adult list', () => {
    for (const name of ['派蒙', '七七', '可莉', '瑶瑶', '早柚']) {
      expect(getNsfwArchiveBlockReason(undefined, name, ''), `${name} 必须被拦住`).not.toBeNull();
    }
  });
});

describe('非成年角色的档案与好感度行为', () => {
  it('does not build an adult archive for a custom female minor', () => {
    const result = enrichNpcArchives(
      [legacy({ id: 'npc_xiaoman', 姓名: '小满', 性别: '女', 介绍: '十岁的学徒', 原著角色: true })],
      { nsfwEnabled: true, maleNsfwArchiveEnabled: false },
    ).records[0]!;

    expect(result.NSFW档案?.年龄确认).not.toBe('adult');
    expect(result.NSFW档案?.是否处女).toBeUndefined();
  });

  it('awards no intimacy affinity to a custom female minor', () => {
    const records = [{
      id: 'npc_xiaoman', 姓名: '小满', aliases: [], gender: '女', travelingTogether: true,
      说明: '十岁的学徒',
    }];

    expect(deriveNarrativeIntimacyFacts('小满亲吻了旅行者。', records, { nsfwEnabled: true })).toEqual([]);
    expect(deriveNarrativeIntimacyFacts('两人发生了性爱关系。', records, { nsfwEnabled: true })).toEqual([]);
    expect(deriveNarrativeIntimacyFacts('小满牵起旅行者的手。', records, { nsfwEnabled: true })).toEqual([]);
  });

  it('still awards affinity to an adult custom character', () => {
    const records = [{
      id: 'npc_adult', 姓名: '成人角色', aliases: [], gender: '女', travelingTogether: true,
      说明: '成年冒险家',
      matureArchive: { ageConfirmation: 'adult' as const, ageConfirmationSource: 'manual' as const },
    }];

    expect(deriveNarrativeIntimacyFacts('成人角色亲吻了旅行者。', records, { nsfwEnabled: true, playerName: '旅行者' }))
      .toContainEqual(expect.objectContaining({ type: 'npc', affinityDelta: 5 }));
  });
});
