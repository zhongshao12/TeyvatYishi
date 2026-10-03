import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { commitTeyvatTurn } from '@/services/teyvatTurnTransaction';
import {
  deriveNarrativeTimeFact,
  factsToTeyvatDomainCommands,
  parseVariableFacts,
  resolveTurnTimeFact,
} from '@/utils/variableFacts';

/**
 * 用户第二轮报告的两件事（2026-09-29）：
 * ① 「好感度变化还是不对」；② 「时间推进有问题」。
 *
 * 本轮用行为探针定位到的真实缺陷（全部先复现、后修复）：
 * A1 模型把提示里印出的当前好感回显成 `affinitySet`（或中文 `好感度`）时，
 *    旧实现 `set` 优先于 `add`，**本回合真实的增量被整段丢弃**（实测 120 → 120，应为 123）。
 * A2 绝对覆盖可以**无声倒退**：140 的角色被一次 `affinitySet: 20` 打成 20（实测）。
 * T1 正文「数日后/几天后/一周后/半个月后/一个月后」全部落到凭空「+3 分钟」，
 *    日期与旅行天数纹丝不动（实测六条中五条完全不动）。
 * T2 `validate` 与命令层各有一处 `Math.min(7, days)`：正文明确写出的「半个月后」被压成 7 天。
 */

function 状态(affinity: number | null = 120) {
  const state = createEmptyTeyvatGameState();
  state.世界.当前日期 = '旅行历 1000.03.07';
  state.世界.当前时间 = '10:00';
  state.世界.旅程天数 = 1;
  if (affinity !== null) {
    state.NPC = [{
      id: 'npc_amber', 姓名: '安柏', aliases: [], 地区: '', 身份: '', 天赋: [], 说明: '', roleTier: 'companion',
      affinity, relationship: 'friend', intimate: false, travelingTogether: true, firstSeenTurn: 1, lastSeenTurn: 1,
      gender: '女', playerAddress: '', appearance: '', clothing: '', speechStyle: '', personality: '',
      equipmentSummary: '', sharedMemories: [], relationshipLedger: {
        recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [],
        unfinishedBusiness: [], unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [],
      },
      notes: [], playerCorrections: [], canonical: true, avatar: '',
      visualArchive: { slotImages: {} }, matureArchive: null,
    }];
  }
  return state;
}

function 提交(state: ReturnType<typeof 状态>, facts: Parameters<typeof factsToTeyvatDomainCommands>[0]) {
  const translated = factsToTeyvatDomainCommands(facts, state, 2);
  const committed = commitTeyvatTurn(state, translated.commands, () => undefined, { lenientEvidence: true });
  return { translated, committed };
}

describe('好感度（2026-09-29 第二轮）', () => {
  it('回显绝对值 + 真实增量：增量必须落地，不被覆盖', () => {
    const { translated, committed } = 提交(状态(120), [{
      type: 'npc', name: '安柏', affinitySet: 120, affinityDelta: 3,
      memory: '一起清剿了丘丘人营地。', evidence: '安柏与旅行者并肩作战。',
    } as never]);
    expect(committed.status).toBe('committed');
    if (committed.status !== 'committed') return;
    expect(committed.nextState.NPC[0]?.affinity).toBe(123);
    expect(translated.warnings.join('\n')).toContain('已忽略');
  });

  it('中文「好感度」回显（模型常用写法）+ 真实增量：同样不丢增量', () => {
    const parsed = parseVariableFacts(`<变量事实>${JSON.stringify([
      {
        type: 'npc', name: '安柏', 好感度: 120, affinityDelta: 3,
        memory: '一起清剿了丘丘人营地。', evidence: '安柏与旅行者并肩作战，配合默契。',
      },
    ])}</变量事实>`);
    expect(parsed.facts).toHaveLength(1);
    const fact = parsed.facts[0] as { affinityDelta?: number; affinitySet?: number };
    expect(fact.affinityDelta).toBe(3);
    // 中文「好感度」被解析成绝对值（历史行为），但命令层必须以增量为准。
    expect(fact.affinitySet).toBe(120);
    const { committed } = 提交(状态(120), parsed.facts);
    if (committed.status !== 'committed') throw new Error('not committed');
    expect(committed.nextState.NPC[0]?.affinity).toBe(123);
  });

  it('生死挚友（>100）不得被一次绝对值覆盖压低', () => {
    const { translated, committed } = 提交(状态(140), [{
      type: 'npc', name: '安柏', affinitySet: 20, evidence: '安柏与旅行者在城门口发生了激烈争执。',
    } as never]);
    if (committed.status !== 'committed') throw new Error('not committed');
    expect(committed.nextState.NPC[0]?.affinity).toBe(140);
    expect(translated.warnings.join('\n')).toContain('生死挚友不因一次变量结算下降');
  });

  it('未到挚友门槛的角色仍允许绝对值覆盖（保留合理下降）', () => {
    const { committed } = 提交(状态(60), [{
      type: 'npc', name: '安柏', affinitySet: 40, evidence: '安柏冷冷地结束了对话。',
    } as never]);
    if (committed.status !== 'committed') throw new Error('not committed');
    expect(committed.nextState.NPC[0]?.affinity).toBe(40);
  });

  it('只给增量时正常累加，且上限 150', () => {
    const { committed } = 提交(状态(148), [{
      type: 'npc', name: '安柏', affinityDelta: 30, evidence: '两人关系急速升温。',
    } as never]);
    if (committed.status !== 'committed') throw new Error('not committed');
    expect(committed.nextState.NPC[0]?.affinity).toBe(150);
  });
});

describe('时间推进（2026-09-29 第二轮）', () => {
  const cases: Array<{ phrase: string; days: number }> = [
    { phrase: '三天后', days: 3 },
    { phrase: '五日后', days: 5 },
    { phrase: '数日后', days: 3 },
    { phrase: '几天后', days: 3 },
    { phrase: '一周后', days: 7 },
    { phrase: '半个月后', days: 15 },
    { phrase: '一个月后', days: 30 },
    { phrase: '一年后', days: 365 },
  ];

  for (const { phrase, days } of cases) {
    it(`「${phrase}」推进 ${days} 天（日期 / 时间 / 旅行天数三者一致）`, () => {
      const state = 状态(null);
      const fact = deriveNarrativeTimeFact(`${phrase}，队伍抵达璃月港。`, '10:00');
      expect(fact, phrase).not.toBeNull();
      expect(fact?.mode, phrase).toBe('next_day');
      expect((fact as { days?: number }).days, phrase).toBe(days);
      const { committed } = 提交(state, [fact!]);
      if (committed.status !== 'committed') throw new Error('not committed');
      expect(committed.nextState.世界.旅程天数).toBe(1 + days);
      expect(committed.nextState.世界.当前时间).toBe('10:00');
    });
  }

  it('「翌日/隔天」仍按 1 天推进', () => {
    for (const phrase of ['翌日', '隔天', '次日']) {
      const fact = deriveNarrativeTimeFact(`${phrase}，队伍继续赶路。`, '10:00');
      expect(fact?.mode, phrase).toBe('next_day');
      expect((fact as { days?: number }).days ?? 1, phrase).toBe(1);
    }
  });

  it('模型自报的跳转仍收紧在 7 天内（防随手编跨度）', () => {
    const decided = resolveTurnTimeFact('队伍休整。', '10:00', {
      type: 'time', mode: 'next_day', days: 30, evidence: '模型自报跳转',
    } as never);
    expect(decided.fact).toBeNull();
    expect(decided.warning).toContain('时间跳转天数无效');
  });

  it('正文跨度超过上限时拦下并给警告，绝不静默乱跳', () => {
    const decided = resolveTurnTimeFact('一千年后，世界已经改换了模样。', '10:00', undefined);
    expect(decided.fact).toBeNull();
    expect(decided.warning).toContain('超出可结算范围');
  });

  it('正文跨夜与同日钟点的区分保持不变', () => {
    expect(deriveNarrativeTimeFact('凌晨三点，营火只剩余烬。', '23:30')?.mode).toBe('next_day');
    expect(deriveNarrativeTimeFact('晚上八点，众人回到营地。', '10:00')?.mode).toBe('set_time');
  });

  it('正文与模型冲突时正文优先（模型 3 分钟不得覆盖「三天后」）', () => {
    const decided = resolveTurnTimeFact('三天后，队伍抵达璃月港。', '10:00', {
      type: 'time', mode: 'elapsed', minutes: 3, evidence: '队伍赶路。',
    });
    expect(decided.fact?.mode).toBe('next_day');
    expect((decided.fact as { days?: number }).days).toBe(3);
  });
});
