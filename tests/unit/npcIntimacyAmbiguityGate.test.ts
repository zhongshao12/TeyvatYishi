import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { commitTeyvatTurn } from '@/services/teyvatTurnTransaction';
import { deriveNarrativeIntimacyFacts, factsToTeyvatDomainCommands } from '@/utils/variableFacts';
import { scanNpcIntimacyEvents } from '@/utils/npcIntimacyEvidence';
import type { NPC记录 } from '@/models/npc';

/**
 * P1-B08（上一轮引入的回归）：普通剧情误触发亲密事件。
 *
 * 上一轮为修「性爱事件只涨几点」往 sex 档加了 `插入`、`合二为一`、`引导.{0,6}进入`
 * 这类**歧义词**，于是正常冒险也被判成 sex：
 *   `安柏将箭矢插入箭袋，旅行者站在一旁。`
 *   `安柏引导旅行者进入蒙德城。`
 *   `安柏和旅行者将两枚符文合二为一。`
 * 三条全部被判 sex（+30、首次经历状态被改写）。
 *
 * 修法：歧义动作只在**同一句另有明确性语境线索**时才计入 sex 档；否则忽略该命中
 * （同句若还有 kiss/touch 词，仍按低档位正常结算）。
 * 既有正确用例必须原样全绿：`tests/unit/npcSexEventAffinity.test.ts`（9 条真实性爱 +30）
 * 与 `tests/unit/npcIntimacyEvidence.test.ts`（保守性）。
 */

const 主角: Array<Pick<NPC记录, 'id' | '姓名'> & {
  aliases?: readonly string[]; gender?: string; 说明?: string; appearance?: string;
  matureArchive?: { ageConfirmation?: 'adult' | 'unknown' | 'minor_blocked'; ageConfirmationSource?: 'canonical' | 'manual' | 'legacy_unverified' } | null;
}> = [{
  id: 'npc_amber', 姓名: '安柏', aliases: [], gender: '女',
  说明: '成年女性骑士', appearance: '成年女性',
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

/** 首次经历改写必须只在**真实**性爱行文时发生。 */
function 是否改写首次经历(body: string): boolean {
  return deriveNarrativeIntimacyFacts(body, 主角, {
    nsfwEnabled: true, playerName: '旅行者', turn: 3, settlementId: 's1',
  }).some((fact) => fact.type === 'nsfw_archive');
}

describe('B08 歧义动作不得单独触发 sex 档', () => {
  const 审查者反例 = [
    '安柏将箭矢插入箭袋，旅行者站在一旁。',
    '安柏引导旅行者进入蒙德城。',
    '安柏和旅行者将两枚符文合二为一。',
  ];

  for (const body of 审查者反例) {
    it(`判空：${body}`, () => {
      expect(档位(body)).toEqual([]);
      expect(好感增量(body)).toBe(0);
      expect(是否改写首次经历(body)).toBe(false);
    });
  }

  const 普通剧情 = [
    // 登床休息（不是性行为）
    '安柏和旅行者上了床，很快就睡着了。',
    '安柏铺好草床，旅行者躺下休息。',
    // 战斗动作
    '安柏将长剑插入地面，旅行者拔出武器迎敌。',
    '安柏引导旅行者进入秘境，里面全是丘丘人。',
    '安柏与旅行者合力将两枚碎片合二为一，封印了机关。',
    // 否定 / 计划 / 转述
    '安柏没有插入任何东西，旅行者只是旁观。',
    '安柏打算引导旅行者进入蒙德城，但还没出发。',
    '安柏说，她曾把箭矢插入箭袋。',
    '安柏看见旅行者把箭插入箭袋。',
  ];

  for (const body of 普通剧情) {
    it(`普通剧情不涨 sex 好感：${body}`, () => {
      expect(档位(body)).not.toContain('sex');
      expect(好感增量(body)).not.toBe(30);
      expect(是否改写首次经历(body)).toBe(false);
    });
  }

  it('歧义动作 + 同句性语境线索仍然计入 sex 档（真实行文不能修丢）', () => {
    // `深处` 是明确性语境线索，与 `引导…进入` 同句。
    expect(档位('安柏引导着旅行者进入，两人在彼此深处找到了节奏。')).toEqual(['sex']);
    expect(好感增量('安柏引导着旅行者进入，两人在彼此深处找到了节奏。')).toBe(30);
    // `进入` 带明确对象时本身就是性语境。
    expect(档位('安柏轻轻引导旅行者进入了她，帐内只剩下喘息。')).toEqual(['sex']);
  });

  it('歧义动作与低档位词同句时按低档位结算，不升档', () => {
    expect(档位('安柏把箭矢插入箭袋，随后吻了旅行者。')).toEqual(['kiss']);
    expect(好感增量('安柏把箭矢插入箭袋，随后吻了旅行者。')).toBe(5);
  });

  it('引号内的转述仍被屏蔽', () => {
    expect(档位('安柏说：「我要引导你进入蒙德城。」')).toEqual([]);
  });
});
