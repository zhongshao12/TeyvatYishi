import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD, 获取NPC关系阶段 } from '@/models/npc';
import { commitTeyvatTurn } from '@/services/teyvatTurnTransaction';
import { deriveNarrativeIntimacyFacts, factsToTeyvatDomainCommands } from '@/utils/variableFacts';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';

/**
 * 玩家指定的好感度事件规则与封顶保护：
 * 亲吻 +5 / 性爱事件 +30 / 暧昧·谈情说爱 +3 / 肢体接触 +3 / 每日同行 +10 / 生死挚友后不再下降。
 */

const npc = (patch: Record<string, unknown> = {}) => ({
  id: 'npc_amber', 姓名: '安柏', 地区: '', 身份: '', 天赋: [], 说明: '', aliases: [],
  roleTier: 'companion' as const, affinity: 0, relationship: 'stranger', intimate: false, travelingTogether: false,
  firstSeenTurn: 1, lastSeenTurn: 1, gender: '女', playerAddress: '旅行者', appearance: '', clothing: '',
  speechStyle: '', personality: '', equipmentSummary: '', sharedMemories: [], relationshipLedger: {
    recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [], unfinishedBusiness: [],
    unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [],
  }, notes: [], playerCorrections: [], canonical: true, avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
  ...patch,
});

const stateWith = (records: ReturnType<typeof npc>[]) => {
  const state = createEmptyTeyvatGameState();
  state.NPC = normalizeTeyvatNpcRecords(records);
  return state;
};

const commitDerived = (body: string, records: ReturnType<typeof npc>[], options: { nsfwEnabled?: boolean } = {}) => {
  const state = stateWith(records);
  const derived = deriveNarrativeIntimacyFacts(body, state.NPC, options);
  const translated = factsToTeyvatDomainCommands(derived, state, 3);
  const committed = commitTeyvatTurn(state, translated.commands, () => undefined, { lenientEvidence: true });
  return { derived, committed };
};

describe('亲密事件固定好感度', () => {
  it.each([
    ['亲吻', '安柏踮起脚尖，轻轻亲吻了旅行者的脸颊。', 5],
    ['性爱事件', '夜深之后，安柏与旅行者共度了彼此交付的性爱时刻。', 30],
    ['暧昧', '安柏侧过头，用近似表白的话说出自己的心意。', 3],
    ['肢体接触', '安柏主动牵起旅行者的手，两人一路都没有松开。', 3],
  ])('awards the fixed value for %s', (_tier, body, expected) => {
    const { derived, committed } = commitDerived(body, [npc()], { nsfwEnabled: true });

    expect(derived).toContainEqual(expect.objectContaining({ type: 'npc', name: '安柏', affinityDelta: expected }));
    expect(committed.status).toBe('committed');
    if (committed.status !== 'committed') return;
    expect(committed.nextState.NPC[0]!.affinity).toBe(expected);
  });

  it('pairs the sex tier with a virginity flip for female characters', () => {
    const { derived } = commitDerived('夜深之后，安柏与旅行者共度了彼此交付的性爱时刻。', [npc()], { nsfwEnabled: true });

    expect(derived).toContainEqual(expect.objectContaining({ type: 'nsfw_archive', npcName: '安柏', virginityStatus: 'not_virgin' }));
  });

  it('takes only the highest matched tier in one turn', () => {
    const { derived } = commitDerived('安柏与旅行者紧紧拥抱，随后亲吻了彼此。', [npc()], { nsfwEnabled: true });

    expect(derived).toEqual([expect.objectContaining({ affinityDelta: 5 })]);
  });

  it('does not attribute an event to an NPC who is not named in the sentence', () => {
    const { derived } = commitDerived('她踮起脚尖，轻轻亲吻了旅行者。', [npc()], { nsfwEnabled: true });

    expect(derived).toEqual([]);
  });

  it('ignores negated intimacy', () => {
    const { derived } = commitDerived('安柏没有亲吻旅行者，只是把披风递了过去。', [npc()], { nsfwEnabled: true });

    expect(derived).toEqual([]);
  });

  it('does not read 抱歉/抱怨 as physical contact', () => {
    const { derived } = commitDerived('安柏抱歉地笑了笑，说自己来晚了。', [npc()], { nsfwEnabled: true });

    expect(derived).toEqual([]);
  });

  it('skips the sex tier when NSFW is disabled but keeps lower tiers', () => {
    const sexOnly = commitDerived('夜深之后，两人有了性爱关系。安柏很平静。', [npc()], { nsfwEnabled: false });
    const withKiss = commitDerived('安柏亲吻了旅行者。', [npc()], { nsfwEnabled: false });

    expect(sexOnly.derived).toEqual([]);
    expect(withKiss.derived).toEqual([expect.objectContaining({ affinityDelta: 5 })]);
  });

  it('never awards intimacy affinity to protected non-adult characters', () => {
    const klee = npc({ id: 'npc_klee', 姓名: '可莉', aliases: [], canonical: true });
    const { derived } = commitDerived('可莉抱住旅行者，亲了亲他的脸颊。', [klee], { nsfwEnabled: true });

    expect(derived).toEqual([]);
  });

  it('keeps the evidence long enough for the settlement evidence gate', () => {
    const { derived, committed } = commitDerived('安柏亲吻了他。', [npc()], { nsfwEnabled: true });

    expect((derived[0]!.evidence ?? '').length).toBeGreaterThanOrEqual(8);
    expect(committed.status).toBe('committed');
  });
});

describe('生死挚友后不再掉好感度', () => {
  const affinityFact = (evidence: string) => [{ domain: 'relationship' as const, fact: evidence, evidence }];

  const run = (from: number, value: number, action: 'add' | 'sub' | 'set' = 'add') => {
    const evidence = '安柏认真地点了点头';
    const state = stateWith([npc({ affinity: from })]);
    const result = commitTeyvatTurn(state, [{
      action, root: 'NPC', path: '[id=npc_amber].affinity', value, evidence,
    }], () => undefined, { factCandidates: affinityFact(evidence) });
    return result.status === 'committed' ? result.nextState.NPC[0]!.affinity : null;
  };

  it('is exactly the 生死挚友 threshold', () => {
    expect(获取NPC关系阶段(NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD)).toBe('知己');
    expect(获取NPC关系阶段(NPC_AFFINITY_DEAREST_FRIEND_THRESHOLD + 1)).toBe('生死挚友');
  });

  it('blocks a decrement at 生死挚友 level instead of clamping to the threshold', () => {
    expect(run(130, 20, 'sub')).toBe(130);
    expect(run(101, 50, 'sub')).toBe(101);
  });

  it('blocks an absolute set below the current value at 生死挚友 level', () => {
    expect(run(130, 50, 'set')).toBe(130);
  });

  it('still allows growth at 生死挚友 level', () => {
    expect(run(101, 5)).toBe(106);
    expect(run(149, 5)).toBe(150);
  });

  it('does not protect an NPC who is merely 知己 (100)', () => {
    expect(run(100, 20, 'sub')).toBe(80);
  });
});
