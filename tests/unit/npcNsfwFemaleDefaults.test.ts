import { describe, expect, it } from 'vitest';
import type { NPC记录 } from '@/models/npc';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import { commitTeyvatTurn } from '@/services/teyvatTurnTransaction';
import { deriveNarrativeIntimacyFacts, factsToTeyvatDomainCommands } from '@/utils/variableFacts';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';

/**
 * 玩家要求：
 * 4. 女角色 NSFW 档案的「年龄确认」全部填上（按原著年龄 = 成年）；
 * 5. 「是否处女」默认「是」，发生性爱事件后变为「否」。
 *
 * 安全约束：受保护的非成年角色（派蒙/七七/可莉/瑶瑶/早柚）永远拿不到成年标记 ——
 * 它们在 NSFW 门禁处就被挡住，压根不会生成档案。
 */

const legacyNpc = (patch: Partial<NPC记录> & { id: string; 姓名: string }): NPC记录 => ({
  阶位: 'companion', 好感度: 0, 关系: 'stranger', 亲密关系: false, 同行: false,
  初见回合: 1, 最近回合: 1, 备注: [], ...patch,
} as NPC记录);

const enrich = (record: NPC记录, options = { nsfwEnabled: true, maleNsfwArchiveEnabled: false }) =>
  enrichNpcArchives([record], options).records[0]!;

describe('女角色 NSFW 档案默认值', () => {
  it('fills 年龄确认 as adult and 是否处女 as 是 for a female character', () => {
    const result = enrich(legacyNpc({ id: 'npc_amber', 姓名: '安柏', 原著角色: true }));

    expect(result.NSFW档案?.年龄确认).toBe('adult');
    expect(result.NSFW档案?.是否处女).toBe('是');
  });

  it('backfills an existing save whose age is still unknown', () => {
    const result = enrich(legacyNpc({
      id: 'npc_lisa', 姓名: '丽莎', 原著角色: true,
      NSFW档案: { enabled: true, 年龄确认: 'unknown', 偏好: ['阅读'] },
    }));

    expect(result.NSFW档案?.年龄确认).toBe('adult');
    expect(result.NSFW档案?.是否处女).toBe('是');
  });

  it('does not overwrite an explicit 否', () => {
    const result = enrich(legacyNpc({
      id: 'npc_lisa', 姓名: '丽莎', 原著角色: true,
      NSFW档案: { enabled: true, 年龄确认: 'adult', 是否处女: '否' },
    }));

    expect(result.NSFW档案?.是否处女).toBe('否');
  });

  it('leaves male characters without the female-only fields', () => {
    const result = enrich(legacyNpc({ id: 'npc_kaeya', 姓名: '凯亚', 原著角色: true }));

    expect(result.NSFW档案?.是否处女).toBeUndefined();
  });

  it('never marks a protected non-adult character as adult', () => {
    const result = enrich(legacyNpc({ id: 'npc_klee', 姓名: '可莉', 原著角色: true }));

    expect(result.NSFW档案?.年龄确认).not.toBe('adult');
    expect(result.NSFW档案?.是否处女).toBeUndefined();
  });

  it('does nothing while NSFW is disabled', () => {
    const result = enrich(
      legacyNpc({ id: 'npc_amber', 姓名: '安柏', 原著角色: true }),
      { nsfwEnabled: false, maleNsfwArchiveEnabled: false },
    );

    expect(result.NSFW档案?.年龄确认).not.toBe('adult');
  });
});

describe('性爱事件后 是否处女 变为 否', () => {
  const npcRecord = (overrides: Record<string, unknown> = {}) => ({
    id: 'npc_amber', 姓名: '安柏', aliases: [], roleTier: 'companion' as const, affinity: 0,
    relationship: 'friend', intimate: false, travelingTogether: false,
    firstSeenTurn: 1, lastSeenTurn: 1, gender: '女', sharedMemories: [], notes: [], playerCorrections: [],
    relationshipLedger: { recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [], unfinishedBusiness: [], unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [] },
    visualArchive: { slotImages: {} },
    matureArchive: {
      enabled: true, ageConfirmation: 'adult' as const, virginityStatus: 'virgin' as const,
      preferences: [], sensitivePoints: [], taboos: [], experiences: [], longTermFacts: [], tags: [],
      femaleBodyProfile: {}, maleBodyProfile: {}, partImages: {},
    },
    ...overrides,
  });

  const run = (body: string, nsfwEnabled = true) => {
    const state = createEmptyTeyvatGameState();
    state.NPC = normalizeTeyvatNpcRecords([npcRecord()]);
    const derived = deriveNarrativeIntimacyFacts(body, state.NPC, { nsfwEnabled });
    const translated = factsToTeyvatDomainCommands(derived, state, 3);
    const committed = commitTeyvatTurn(state, translated.commands, () => undefined, { lenientEvidence: true });
    return { derived, committed };
  };

  it('emits a virginity flip alongside the +30 sex bonus', () => {
    const { derived, committed } = run('夜深之后，安柏与旅行者发生了性爱关系。');

    expect(derived).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'npc', affinityDelta: 30 }),
      expect.objectContaining({ type: 'nsfw_archive', npcName: '安柏', virginityStatus: 'not_virgin' }),
    ]));
    expect(committed.status).toBe('committed');
    if (committed.status !== 'committed') return;
    expect(committed.nextState.NPC[0]!.affinity).toBe(30);
    expect(committed.nextState.NPC[0]!.matureArchive?.virginityStatus).toBe('not_virgin');
    // 已经成年因此仍然保留 年龄确认。
    expect(committed.nextState.NPC[0]!.matureArchive?.ageConfirmation).toBe('adult');
  });

  it('does not flip on a kiss', () => {
    const { derived, committed } = run('安柏轻轻亲吻了旅行者。');

    expect(derived.some((fact) => fact.type === 'nsfw_archive')).toBe(false);
    expect(committed.status).toBe('committed');
    if (committed.status !== 'committed') return;
    expect(committed.nextState.NPC[0]!.matureArchive?.virginityStatus).toBe('virgin');
  });

  it('does not flip while NSFW is disabled', () => {
    const { derived } = run('夜深之后，安柏与旅行者发生了性爱关系。', false);

    expect(derived).toEqual([]);
  });

  it('does not flip for a male character', () => {
    const state = createEmptyTeyvatGameState();
    state.NPC = normalizeTeyvatNpcRecords([npcRecord({ id: 'npc_kaeya', 姓名: '凯亚', gender: '男' })]);
    const derived = deriveNarrativeIntimacyFacts('夜深之后，凯亚与旅行者发生了性爱关系。', state.NPC, { nsfwEnabled: true });

    expect(derived).toEqual([expect.objectContaining({ type: 'npc', affinityDelta: 30 })]);
  });
});
