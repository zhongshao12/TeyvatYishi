import { describe, expect, it } from 'vitest';
import { getNsfwArchiveBlockReason } from '@/utils/nsfwArchivePolicy';
import { resolveNpcAdultEligibility } from '@/utils/npcAdultEligibility';
import { getCanonicalArchiveBaselineAge, enableNpcNsfwArchive } from '@/utils/npcArchiveEnrichment';
import { 创建NPC记录 } from '@/models/npc';

/**
 * 「把角色琴从非成人、机械或非人形对象屏蔽规则中移除」（2026-10-03 玩家要求）。
 *
 * 旧实现把 `机械|机关|机器人|人偶|傀儡|投影|怪物|魔物` 无差别扫过 姓名+别名+介绍+外貌+备注，
 * 于是**职责与比喻用法**也会整条拦截：
 *   - 「常年讨伐魔物」（骑士团的日常职责）；
 *   - 「机械地处理公文」（副词用法）；
 *   - 「西风骑士团机关」（机构义）。
 * 琴 就属于这一类成年人类角色，被误判成「非成人 / 机械 / 非人形对象」。
 *
 * 现在的判定分档：姓名/别名里的对象词 → 拦；自由文本里的对象词 → 只有自我描述句式
 * （是/为/属于/本体是/被称为/由…制造）或「几乎不用于人类」的名词（人偶/傀儡/机器人/机械造物）
 * 且不是比喻用法才算；原著成年基线角色的自由文本整档跳过。
 */

const 琴记录 = (patch: Record<string, unknown> = {}) => ({
  ...创建NPC记录({ 姓名: '琴', 阶位: 'companion', 初见回合: 1, 原著角色: true }),
  id: 'npc_jean',
  性别: '女',
  ...patch,
}) as never;

describe('A 琴不再被自由文本词表误伤', () => {
  it('职责描述里的「魔物」「机械地」不再拦截琴', () => {
    const npc = 琴记录({
      介绍: '西风骑士团代理团长，常年讨伐魔物，处理公务时机械地重复着同样的流程。',
    });
    expect(getNsfwArchiveBlockReason(npc, '琴', '', { canonicalAdultBaseline: true })).toBeNull();
    const eligibility = resolveNpcAdultEligibility({
      name: '琴',
      description: (npc as { 介绍: string }).介绍,
      canonicalBaselineAge: getCanonicalArchiveBaselineAge('琴'),
    });
    expect(eligibility).toMatchObject({ confirmed: true, reason: '原著角色可信成年基线' });
  });

  it('「机关」作为机构义的描述同样不拦截', () => {
    const npc = 琴记录({ 备注: ['西风骑士团机关事务由她统筹。'] });
    expect(getNsfwArchiveBlockReason(npc, '琴', '', { canonicalAdultBaseline: true })).toBeNull();
  });

  it('琴 可以直接开启 NSFW 档案（玩家要求的那一步）', () => {
    const npc = 琴记录({ 介绍: '常年讨伐魔物的西风骑士团代理团长。' });
    const result = enableNpcNsfwArchive(npc as never, { confirmAdult: true, maleNsfwArchiveEnabled: true, nsfwEnabled: true });
    expect(result.reason).toBe('原著角色可信成年基线');
    expect(result.archive).toMatchObject({ enabled: true, 年龄确认: 'adult', 年龄确认来源: 'canonical' });
  });
});

describe('B 真正的屏蔽规则一条都没有放宽', () => {
  it('受保护幼态原著名单仍然拦截（含不在原著角色库里的名字）', () => {
    for (const name of ['派蒙', '七七', '可莉', '瑶瑶', '早柚']) {
      expect(getNsfwArchiveBlockReason(undefined, name, ''), `${name} 必须被拦住`).not.toBeNull();
    }
  });

  it('未成年年龄证据仍然拦截', () => {
    expect(getNsfwArchiveBlockReason(undefined, '小满', '十岁的学徒')).not.toBeNull();
    expect(getNsfwArchiveBlockReason(undefined, '原创角色', '十七周岁')).not.toBeNull();
  });

  it('姓名/别名本身就是对象词的仍然拦截', () => {
    expect(getNsfwArchiveBlockReason(undefined, '普通人偶', '机械投影')).not.toBeNull();
    expect(getNsfwArchiveBlockReason({ 姓名: '机械造物-01' } as never, '机械造物-01', '')).not.toBeNull();
  });

  it('自我描述式的机械/人偶对象仍然拦截', () => {
    expect(getNsfwArchiveBlockReason({ 姓名: '银色少女', 介绍: '她是一具由古代技术制造的人偶。' } as never, '银色少女', '')).not.toBeNull();
    expect(getNsfwArchiveBlockReason({ 姓名: '无名者', 外貌: '精致的机械人偶，关节处可见齿轮。' } as never, '无名者', '')).not.toBeNull();
  });

  it('比喻用法不算身份（不会把人类角色拦掉）', () => {
    expect(getNsfwArchiveBlockReason({ 姓名: '原创舞者', 外貌: '她像人偶般顺从而沉默。' } as never, '原创舞者', '')).toBeNull();
  });

  it('合成词与副词用法不得误伤（人偶师 / 傀儡戏 / 认为 / 因为）', () => {
    for (const text of [
      '她认为机关事务繁琐。',
      '因为机械故障，工坊停摆。',
      '作为人偶师，她常年在剧场工作。',
      '傀儡戏在城中很受欢迎。',
      '她机械地重复着同样的流程。',
    ]) {
      expect(getNsfwArchiveBlockReason({ 姓名: '原创角色', 介绍: text } as never, '原创角色', ''), text).toBeNull();
    }
  });

  it('身份断言对原著成年角色同样算数（只有顺带提及/比喻被豁免）', () => {
    expect(getNsfwArchiveBlockReason(
      { 姓名: '琴', 介绍: '她是一具由古代技术制造的人偶。' } as never,
      '琴', '', { canonicalAdultBaseline: true },
    )).not.toBeNull();
    expect(getNsfwArchiveBlockReason(
      { 姓名: '琴', 介绍: '常年讨伐魔物的西风骑士团代理团长。' } as never,
      '琴', '', { canonicalAdultBaseline: true },
    )).toBeNull();
  });

  it('名单里的英译名同样拦截（七七/瑶瑶/早柚 不在原著角色库里）', () => {
    for (const name of ['Paimon', 'Qiqi', 'Klee', 'Yaoyao', 'Sayu', '应急食品', '火花骑士']) {
      expect(getNsfwArchiveBlockReason(undefined, name, ''), name).not.toBeNull();
    }
  });
});
