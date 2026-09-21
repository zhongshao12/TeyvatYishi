import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import type { TeyvatDomainCommand } from '@/models/teyvat/domainCommand';
import { commitTeyvatTurn, reduceTeyvatTurn } from '@/services/teyvatTurnTransaction';
import { factsToTeyvatDomainCommands } from '@/utils/variableFacts';

/**
 * 好感度结算边界。
 *
 * 修复前：`applyNpc` 在结果越过 150（或低于 -50）时返回 INVALID_NUMERIC_RESULT，
 * 而 variableSettlementWorkflow 只把出错的那条命令剔掉再提交 —— 玩家看到的是
 * 「一直在互动，好感度却停住」，且回执里只有一条错误码。
 * 现在是夹取到边界；顺带按旧路径的规则取整。
 */

const evidence = '安柏认真地点了点头';

const facts = [{ domain: 'relationship' as const, fact: '安柏更信任旅行者', evidence }];

const npcRecord = (affinity: number) => ({
  id: 'npc_amber', 姓名: '安柏', 地区: '', 身份: '', 天赋: [], 说明: '', aliases: [],
  roleTier: 'companion' as const, affinity, relationship: 'friend', intimate: false, travelingTogether: true,
  firstSeenTurn: 1, lastSeenTurn: 1, gender: '女', playerAddress: '旅行者', appearance: '', clothing: '',
  speechStyle: '', personality: '', equipmentSummary: '', sharedMemories: [], relationshipLedger: {
    recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [], unfinishedBusiness: [],
    unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [],
  }, notes: [], playerCorrections: [], canonical: true, avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
});

const stateWith = (affinity: number) => {
  const state = createEmptyTeyvatGameState();
  state.NPC.push(npcRecord(affinity));
  return state;
};

const affinityCommand = (patch: Partial<TeyvatDomainCommand> = {}): TeyvatDomainCommand => ({
  action: 'add', root: 'NPC', path: '[id=npc_amber].affinity', value: 5, evidence, ...patch,
});

describe('affinity settlement bounds', () => {
  it('clamps to 150 instead of dropping the increment', () => {
    const result = reduceTeyvatTurn(stateWith(146), [affinityCommand()], { factCandidates: facts });

    expect(result.status).toBe('accepted');
    expect(result.nextState.NPC[0]!.affinity).toBe(150);
  });

  it('keeps 150 stable when the increment would overflow', () => {
    const result = reduceTeyvatTurn(stateWith(150), [affinityCommand()], { factCandidates: facts });

    expect(result.status).toBe('accepted');
    expect(result.nextState.NPC[0]!.affinity).toBe(150);
  });

  it('clamps to -50 instead of dropping the penalty', () => {
    const result = reduceTeyvatTurn(stateWith(-48), [affinityCommand({ value: -5 })], { factCandidates: facts });

    expect(result.status).toBe('accepted');
    expect(result.nextState.NPC[0]!.affinity).toBe(-50);
  });

  it('clamps an out-of-range absolute set', () => {
    const high = reduceTeyvatTurn(stateWith(10), [affinityCommand({ action: 'set', value: 999 })], { factCandidates: facts });
    const low = reduceTeyvatTurn(stateWith(10), [affinityCommand({ action: 'set', value: -999 })], { factCandidates: facts });

    expect(high.nextState.NPC[0]!.affinity).toBe(150);
    expect(low.nextState.NPC[0]!.affinity).toBe(-50);
  });

  it('keeps affinity an integer so the legacy and domain paths agree', () => {
    const result = reduceTeyvatTurn(stateWith(40), [affinityCommand({ value: 1.5 })], { factCandidates: facts });

    expect(result.nextState.NPC[0]!.affinity).toBe(41);
    expect(Number.isInteger(result.nextState.NPC[0]!.affinity)).toBe(true);
  });

  it('still rejects a non-finite value', () => {
    const result = reduceTeyvatTurn(
      stateWith(40),
      [affinityCommand({ value: Number.POSITIVE_INFINITY })],
      { factCandidates: facts },
    );

    expect(result.status).toBe('rejected');
    expect(result.errors[0]?.code).toBe('INVALID_VALUE');
  });

  it('keeps the derived relationship stage in sync with the clamped value', () => {
    const result = reduceTeyvatTurn(stateWith(146), [affinityCommand()], { factCandidates: facts });

    expect(result.nextState.NPC[0]!.relationship).toBe('close');
    expect(result.nextState.NPC[0]!.relationshipLedger.currentStage).toBe('生死挚友');
  });
});

describe('narrative day jumps feed the daily companion bonus', () => {
  const fresh = () => {
    const state = stateWith(0);
    state.世界.当前日期 = '旅行历 1000.03.07';
    state.世界.当前时间 = '22:30';
    state.世界.旅程天数 = 1;
    return state;
  };

  it('applies an explicit multi-day skip without needing whitelist words in the evidence', () => {
    const state = fresh();
    const translated = factsToTeyvatDomainCommands(
      [{ type: 'time', mode: 'elapsed', minutes: 3 * 1440, evidence: '三天后，队伍抵达璃月港。' }],
      state,
      2,
    );
    const committed = commitTeyvatTurn(state, translated.commands, () => undefined, { lenientEvidence: true });

    expect(committed.status).toBe('committed');
    if (committed.status !== 'committed') return;
    expect(committed.nextState.世界.旅程天数).toBe(4);
    expect(committed.nextState.世界.当前日期).toBe('旅行历 1000.03.10');
    // 每日同行 5 × 3 天，以前因为证据里没有「等待/赶路」这类词会被压成 30 分钟而完全不发。
    expect(committed.nextState.NPC[0]!.affinity).toBe(15);
  });

  it('still advances minutes only for a same-day step', () => {
    const state = fresh();
    state.世界.当前时间 = '10:00';
    const translated = factsToTeyvatDomainCommands(
      [{ type: 'time', mode: 'elapsed', minutes: 180, evidence: '三个小时后，调查告一段落。' }],
      state,
      2,
    );
    const committed = commitTeyvatTurn(state, translated.commands, () => undefined, { lenientEvidence: true });

    expect(committed.status).toBe('committed');
    if (committed.status !== 'committed') return;
    expect(committed.nextState.世界.旅程天数).toBe(1);
    expect(committed.nextState.NPC[0]!.affinity).toBe(0);
  });

  it('caps an absurd duration at seven days', () => {
    const state = fresh();
    const translated = factsToTeyvatDomainCommands(
      // 证据串必须 ≥8 字：`matchesEvidence` 的宽松模式有长度门槛，太短会整批 UNMATCHED_EVIDENCE。
      [{ type: 'time', mode: 'elapsed', minutes: 90 * 1440, evidence: '很久以后，队伍终于抵达璃月港。' }],
      state,
      2,
    );
    const committed = commitTeyvatTurn(state, translated.commands, () => undefined, { lenientEvidence: true });

    expect(committed.status).toBe('committed');
    if (committed.status !== 'committed') return;
    expect(committed.nextState.世界.旅程天数).toBe(8);
  });
});
