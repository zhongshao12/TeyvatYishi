import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { commitTeyvatTurn } from '@/services/teyvatTurnTransaction';
import { deriveNarrativeIntimacyFacts, factsToTeyvatDomainCommands } from '@/utils/variableFacts';
import { scanNpcIntimacyEvents } from '@/utils/npcIntimacyEvidence';
import type { NPC记录 } from '@/models/npc';

/**
 * 用户第三轮报告：「明明是性爱事件，好感度必须增加很多，但结算只增加了几点」。
 *
 * 实测根因（2026-09-29，全部先复现再修）——**不是档位数值错**（`sex = 30` 一直是对的），
 * 而是 `utils/npcIntimacyEvidence.ts` 有三处让性爱场景**根本识别不到**，
 * 于是只剩变量模型被允许输出的保守兜底（+1~+5），玩家看到的就是「只涨几点」：
 *
 * A. 词表缺词：sex 档只认 性爱/做爱/交合/性交/交欢/欢好/欢爱/云雨/巫山/鱼水之欢/春宵/缠绵/亲热/温存，
 *    真实行文常用的「进入了她」「融为一体」「结合」「深处」「抽送」「律动」「高潮中」「要了她」
 *    「同房/行房/床笫」全部不命中 → 整条 0 分（探针实测 9 条里 7 条为 0）。
 * B. 集体主语不归属：「两人」「他们」「彼此」不是可归属主体。
 * C. 玩家参与判定是**子句级**：`安柏把旅行者按在墙上，两人做爱到天明。` 里玩家在前一子句
 *    → 整条丢弃。保守性本身是有意的（既有测试钉住），所以只对 sex 档放宽到句级，
 *    并要求该子句里不得出现**其他** NPC。
 */

const 主角: Array<Pick<NPC记录, 'id' | '姓名'> & {
  aliases?: readonly string[]; gender?: string; travelingTogether?: boolean; 同行?: boolean;
  说明?: string; appearance?: string; notes?: readonly string[];
  matureArchive?: { ageConfirmation?: 'adult' | 'unknown' | 'minor_blocked'; ageConfirmationSource?: 'canonical' | 'manual' | 'legacy_unverified' } | null;
}> = [{
  id: 'npc_amber', 姓名: '安柏', aliases: [], gender: '女',
  travelingTogether: false, 说明: '成年女性骑士', appearance: '成年女性', notes: [],
  matureArchive: { ageConfirmation: 'adult', ageConfirmationSource: 'manual' },
}];

function 档位(body: string): string[] {
  return scanNpcIntimacyEvents(body, [{ id: 'npc_amber', 姓名: '安柏', eligible: true, allowSex: true }], {
    playerName: '旅行者', allowSex: true,
  }).map((match) => match.tier);
}

function 好感增量(body: string): number {
  const facts = deriveNarrativeIntimacyFacts(body, 主角, {
    nsfwEnabled: true, playerName: '旅行者', turn: 3, settlementId: 's1',
  });
  const state = createEmptyTeyvatGameState();
  state.NPC = [{
    id: 'npc_amber', 姓名: '安柏', aliases: [], 地区: '', 身份: '', 天赋: [], 说明: '', roleTier: 'companion',
    affinity: 100, relationship: 'friend', intimate: false, travelingTogether: false, firstSeenTurn: 1, lastSeenTurn: 1,
    gender: '女', playerAddress: '', appearance: '', clothing: '', speechStyle: '', personality: '',
    equipmentSummary: '', sharedMemories: [], relationshipLedger: {
      recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [],
      unfinishedBusiness: [], unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [],
    },
    notes: [], playerCorrections: [], canonical: true, avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
  }];
  const translated = factsToTeyvatDomainCommands(facts, state, 3);
  const committed = commitTeyvatTurn(state, translated.commands, () => undefined, { lenientEvidence: true });
  if (committed.status !== 'committed') return -1;
  return (committed.nextState.NPC[0]?.affinity ?? 0) - 100;
}

describe('性爱事件必须结算 +30（2026-09-29 第三轮）', () => {
  const 性爱行文: string[] = [
    '安柏把旅行者按在墙上，两人做爱到天明。',
    '篝火熄灭后，安柏与旅行者交合，直到晨光透进帐篷。',
    '安柏与旅行者缠绵了一整夜，帐篷里只剩下彼此的呼吸。',
    '一夜云雨，安柏在旅行者怀里睡去。',
    '安柏轻轻叹息，与旅行者融为一体，直到天亮才分开。',
    '安柏没有拒绝，旅行者要了她，帐外风雪呼啸。',
    '安柏引导着旅行者进入，两人在彼此深处找到了节奏。',
    '安柏的喘息越来越急，与旅行者的律动在高潮中停下。',
    '这一夜，安柏与旅行者同房，直到东方既白。',
  ];

  for (const body of 性爱行文) {
    it(`识别为 sex 档并结算 +30：${body}`, () => {
      expect(档位(body)).toEqual(['sex']);
      expect(好感增量(body)).toBe(30);
    });
  }

  it('低档位对照：亲吻 +5、拥抱 +3（不得被 sex 档吞掉）', () => {
    expect(档位('安柏踮起脚，吻住了旅行者。')).toEqual(['kiss']);
    expect(好感增量('安柏踮起脚，吻住了旅行者。')).toBe(5);
    expect(档位('安柏抱住旅行者，久久没有松手。')).toEqual(['touch']);
    expect(好感增量('安柏抱住旅行者，久久没有松手。')).toBe(3);
  });

  it('保守边界不破：第三人场景与「玩家只在旁看着」仍不结算', () => {
    for (const body of [
      '安柏告诉旅行者，丽莎亲吻了琴。',
      '安柏亲吻了琴，旅行者在旁边看着。',
      '丽莎与琴在帐篷里缠绵，旅行者在旁边看着。',
    ]) {
      expect(档位(body)).toEqual([]);
    }
  });

  it('保守边界不破：低档位仍要求玩家与动作在同一子句', () => {
    expect(档位('安柏在旅行者耳边低语，随后相拥而眠。')).toEqual([]);
  });

  it('NSFW 关闭时性爱档不结算（亲吻仍 +5）', () => {
    const facts = deriveNarrativeIntimacyFacts('安柏把旅行者按在墙上，两人做爱到天明。', 主角, {
      nsfwEnabled: false, playerName: '旅行者', turn: 3, settlementId: 's1',
    });
    expect(facts).toEqual([]);
    const kissFacts = deriveNarrativeIntimacyFacts('安柏踮起脚，吻住了旅行者。', 主角, {
      nsfwEnabled: false, playerName: '旅行者', turn: 3, settlementId: 's1',
    });
    expect((kissFacts[0] as { affinityDelta?: number } | undefined)?.affinityDelta).toBe(5);
  });

  it('同一回合只结算最高档一次（性爱场景里的亲吻不额外加）', () => {
    const body = '安柏踮起脚吻住旅行者，随后两人做爱到天明。';
    expect(档位(body)).toEqual(['sex']);
    expect(好感增量(body)).toBe(30);
  });
});
