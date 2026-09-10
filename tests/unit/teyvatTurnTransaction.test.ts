import { describe, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState } from '../../models/teyvat';
import type { TeyvatDomainCommand } from '../../models/teyvat/domainCommand';
import { factsToTeyvatDomainCommands } from '../../utils/variableFacts';
import {
  commitTeyvatTurn,
  reduceTeyvatTurn,
  runCommittedTurnEffects,
} from '../../services/teyvatTurnTransaction';

const facts = [
  { domain: 'location' as const, fact: '旅行者抵达蒙德城', evidence: '城门在晨光中打开' },
  { domain: 'inventory' as const, fact: '获得提瓦特煎蛋', evidence: '安柏递来一份煎蛋' },
  { domain: 'relationship' as const, fact: '安柏更信任旅行者', evidence: '安柏认真地点了点头' },
  { domain: 'quest' as const, fact: '侦察任务已登记', evidence: '骑士团发布了侦察委托' },
  { domain: 'system' as const, fact: '信使与原著轨道服务结算', evidence: '系统结算' },
];

const command = (patch: Partial<TeyvatDomainCommand> = {}): TeyvatDomainCommand => ({
  action: 'set',
  root: '世界',
  path: '当前地点',
  value: '蒙德城',
  evidence: '城门在晨光中打开',
  ...patch,
});

describe('reduceTeyvatTurn', () => {
  it('accepts an exact world location command without mutating the initial state or command', () => {
    const initial = createEmptyTeyvatGameState();
    const input = command({ extra: 'drop-me' } as Partial<TeyvatDomainCommand>);
    const before = structuredClone(input);

    const result = reduceTeyvatTurn(initial, [input], { factCandidates: facts });

    expect(result.status).toBe('accepted');
    expect(result.nextState).not.toBe(initial);
    expect(result.nextState.世界.当前地点).toBe('蒙德城');
    expect(initial.世界.当前地点).toBe('');
    expect(input).toEqual(before);
    expect(result.commands[0]).not.toHaveProperty('extra');
  });

  it('rejects a mixed valid and legacy traveler batch atomically with the original reference', () => {
    const initial = createEmptyTeyvatGameState();
    const result = reduceTeyvatTurn(initial, [
      command(),
      command({ root: '旅行者', path: '命途列表', value: ['毁灭'] }),
    ], { factCandidates: facts });

    expect(result.status).toBe('rejected');
    expect(result.nextState).toBe(initial);
    expect(result.errors.map((error) => error.code)).toContain('LEGACY_PATH');
    expect(initial.世界.当前地点).toBe('');
  });

  it.each([
    [command({ action: 'merge' as never }), 'INVALID_ACTION'],
    [command({ root: 'Phone' as never }), 'UNKNOWN_ROOT'],
    [command({ path: '' }), 'EMPTY_PATH'],
    [command({ path: '__proto__.polluted' }), 'UNSAFE_PATH'],
    [command({ path: '*' }), 'WILDCARD_PATH'],
    [command({ root: 'NPC', path: '[name=安柏].affinity', evidence: '安柏认真地点了点头' }), 'DYNAMIC_SELECTOR'],
    [command({ path: '$', value: {} }), 'WHOLE_DOMAIN_REPLACE'],
    [command({ path: '不存在' }), 'UNKNOWN_PATH'],
  ])('rejects unsafe registry input with stable codes: %s', (input, code) => {
    const initial = createEmptyTeyvatGameState();
    const result = reduceTeyvatTurn(initial, [input], { factCandidates: facts });
    expect(result.status).toBe('rejected');
    expect(result.errors[0]?.code).toBe(code);
    expect(result.nextState).toBe(initial);
  });

  it.each([
    [command({ evidence: '' }), 'MISSING_EVIDENCE'],
    [command({ evidence: '无' }), 'MISSING_EVIDENCE'],
    [command({ evidence: '正文里不存在' }), 'UNMATCHED_EVIDENCE'],
  ])('requires evidence matched to NarrativeTurn facts: %s', (input, code) => {
    const result = reduceTeyvatTurn(createEmptyTeyvatGameState(), [input], { factCandidates: facts });
    expect(result.status).toBe('rejected');
    expect(result.errors[0]?.code).toBe(code);
  });

  it('validates representative traveler/world/NPC/inventory/quest/courier/canon commands', () => {
    const initial = createEmptyTeyvatGameState();
    initial.NPC.push({
      id: 'npc_amber', 姓名: '安柏', 地区: 'mondstadt', 身份: '侦察骑士', 天赋: [], 说明: '', aliases: [],
      roleTier: 'companion', affinity: 1, relationship: 'friend', intimate: false, travelingTogether: true,
      firstSeenTurn: 1, lastSeenTurn: 1, gender: '女', playerAddress: '旅行者', appearance: '', clothing: '',
      speechStyle: '', personality: '', equipmentSummary: '', sharedMemories: [], relationshipLedger: {
        recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [], unfinishedBusiness: [],
        unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [],
      }, notes: [], playerCorrections: [], canonical: true, avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
    });
    const commands: TeyvatDomainCommand[] = [
      command({ action: 'push', root: '旅行者', path: 'capabilities', value: '风之翼驾驶' }),
      command({ action: 'add', root: '世界', path: '旅程天数', value: 1 }),
      command({ action: 'add', root: 'NPC', path: '[id=npc_amber].affinity', value: 2, evidence: '安柏认真地点了点头' }),
      command({ action: 'push', root: '背包', path: 'items', evidence: '安柏递来一份煎蛋', value: {
        id: 'item_food_egg', category: 'food', name: '提瓦特煎蛋', description: '', quantity: 1,
        rarity: 1, obtainedAtTurn: 1,
      } }),
      command({ action: 'push', root: '任务', path: 'active', evidence: '骑士团发布了侦察委托', value: {
        id: 'quest_scout', title: '侦察城外', description: '', source: 'side', status: 'active', objectives: [],
        rewards: [], createdAtTurn: 1, updatedAt: 1,
      } }),
      command({ action: 'push', root: '信使', path: 'contacts', evidence: '系统结算', value: {
        id: 'contact_amber', name: '安柏', available: true,
      } }),
      command({ action: 'set', root: '原著轨道', path: 'currentAnchor', evidence: '系统结算', value: 'teyvat_prologue_mondstadt_act1' }),
    ];

    const result = reduceTeyvatTurn(initial, commands, { factCandidates: facts });
    expect(result.status).toBe('accepted');
    expect(result.nextState.旅行者.capabilities).toEqual(['风之翼驾驶']);
    expect(result.nextState.世界.旅程天数).toBe(2);
    expect(result.nextState.NPC[0].affinity).toBe(3);
    expect(result.nextState.背包.items[0].id).toBe('item_food_egg');
    expect(result.nextState.任务.active[0].id).toBe('quest_scout');
    expect(result.nextState.手机.contacts[0].id).toBe('contact_amber');
    expect(result.nextState.原著轨道.currentAnchor).toBe('teyvat_prologue_mondstadt_act1');
  });

  it('rejects invalid ranges and missing stable IDs atomically', () => {
    const initial = createEmptyTeyvatGameState();
    const result = reduceTeyvatTurn(initial, [
      command({ action: 'sub', root: '世界', path: '旅程天数', value: 2 }),
      command({ action: 'sub', root: '背包', path: 'items[id=missing].quantity', value: 1, evidence: '安柏递来一份煎蛋' }),
      command({ action: 'add', root: 'NPC', path: '[id=missing].affinity', value: Number.POSITIVE_INFINITY, evidence: '安柏认真地点了点头' }),
    ], { factCandidates: facts });
    expect(result.status).toBe('rejected');
    expect(result.nextState).toBe(initial);
    expect(result.errors.map((error) => error.code)).toEqual([
      'INVALID_NUMERIC_RESULT', 'MISSING_TARGET_ID', 'INVALID_VALUE',
    ]);
  });

  it('keeps deterministic error order and deduplicates identity/list pushes without mutating values', () => {
    const initial = createEmptyTeyvatGameState();
    const value = { id: 'contact_amber', name: '安柏', available: true };
    const result = reduceTeyvatTurn(initial, [
      command({ action: 'push', root: '信使', path: 'contacts', value, evidence: '系统结算' }),
      command({ action: 'push', root: '信使', path: 'contacts', value, evidence: '系统结算' }),
      command({ action: 'push', root: '旅行者', path: 'capabilities', value: '风之翼驾驶' }),
      command({ action: 'push', root: '旅行者', path: 'capabilities', value: '风之翼驾驶' }),
    ], { factCandidates: facts });
    expect(result.status).toBe('accepted');
    expect(result.nextState.手机.contacts).toHaveLength(1);
    expect(result.nextState.旅行者.capabilities).toEqual(['风之翼驾驶']);
    expect(value).toEqual({ id: 'contact_amber', name: '安柏', available: true });
  });

  it('accepts Unicode-safe CJK NPC and inventory IDs in values and selectors', () => {
    const initial = createEmptyTeyvatGameState();
    initial.NPC = [{
      id: '角色_安柏', 姓名: '安柏', 地区: '蒙德', 身份: '', 天赋: [], 说明: '', aliases: [], roleTier: 'companion',
      affinity: 0, relationship: '', intimate: false, travelingTogether: false, firstSeenTurn: 1, lastSeenTurn: 1,
      gender: '女', playerAddress: '', appearance: '', clothing: '', speechStyle: '', personality: '', equipmentSummary: '',
      sharedMemories: [], relationshipLedger: { recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [], unfinishedBusiness: [], unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [] },
      notes: [], playerCorrections: [], canonical: true, avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
    }];
    initial.背包.items = [{ id: '材料_晶核', category: 'material', name: '晶核', description: '', quantity: 1, rarity: 3, obtainedAtTurn: 1, stackable: true }];
    const result = reduceTeyvatTurn(initial, [
      command({ action: 'add', root: 'NPC', path: '[id=角色_安柏].affinity', value: 2, evidence: '安柏认真地点了点头' }),
      command({ action: 'add', root: '背包', path: 'items[id=材料_晶核].quantity', value: 3, evidence: '安柏递来一份煎蛋' }),
    ], { factCandidates: facts });
    expect(result.status).toBe('accepted');
    expect(result.nextState.NPC[0].affinity).toBe(2);
    expect(result.nextState.背包.items[0].quantity).toBe(4);
  });

  it('strictly rebuilds nested quest and NPC payloads and drops unknown keys', () => {
    const initial = createEmptyTeyvatGameState();
    initial.NPC = [{
      id: 'npc_amber', 姓名: '安柏', 地区: '', 身份: '', 天赋: [], 说明: '', aliases: [], roleTier: 'companion', affinity: 0,
      relationship: '', intimate: false, travelingTogether: false, firstSeenTurn: 1, lastSeenTurn: 1, gender: '女', playerAddress: '', appearance: '', clothing: '', speechStyle: '', personality: '', equipmentSummary: '', sharedMemories: [],
      relationshipLedger: { recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [], unfinishedBusiness: [], unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [] }, notes: [], playerCorrections: [], canonical: true, avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
    }];
    const result = reduceTeyvatTurn(initial, [
      command({ action: 'push', root: '任务', path: 'active', evidence: '骑士团发布了侦察委托', value: {
        id: '任务_侦察', title: '侦察', description: '城外', source: 'side', status: 'active', createdAtTurn: 1, updatedAt: 1,
        objectives: [{ id: '目标_一', type: 'talk', description: '与安柏交谈', targetCount: 1, currentCount: 0, completed: false, injected: true }],
        rewards: ['物品:原石:2'], injected: true,
      } }),
      command({ action: 'push', root: 'NPC', path: '[id=npc_amber].sharedMemories', evidence: '安柏认真地点了点头', value: {
        id: '记忆_一', turn: 1, summary: '共同侦察', source: 'narrative', relatedNpcIds: ['npc_amber'], injected: true,
      } }),
      command({ action: 'set', root: 'NPC', path: '[id=npc_amber].matureArchive', evidence: '安柏认真地点了点头', value: {
        enabled: true, ageConfirmation: 'adult', preferences: ['冒险'], sensitivePoints: [], taboos: [],
        femaleBodyProfile: {}, maleBodyProfile: {}, experiences: [], longTermFacts: [], tags: [], partImages: {}, injected: true,
      } }),
    ], { factCandidates: facts });
    expect(result.status).toBe('accepted');
    expect(result.nextState.任务.active[0]).not.toHaveProperty('injected');
    expect(result.nextState.任务.active[0].objectives[0]).not.toHaveProperty('injected');
    expect(result.nextState.NPC[0].sharedMemories[0]).not.toHaveProperty('injected');
    expect(result.nextState.NPC[0].matureArchive).not.toHaveProperty('injected');
  });

  it('rejects malformed nested quest, shared-memory, and mature-archive shapes atomically', () => {
    const initial = createEmptyTeyvatGameState();
    initial.NPC = [{
      id: 'npc_amber', 姓名: '安柏', 地区: '', 身份: '', 天赋: [], 说明: '', aliases: [], roleTier: 'companion', affinity: 0,
      relationship: '', intimate: false, travelingTogether: false, firstSeenTurn: 1, lastSeenTurn: 1, gender: '女', playerAddress: '', appearance: '', clothing: '', speechStyle: '', personality: '', equipmentSummary: '', sharedMemories: [], relationshipLedger: { recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [], unfinishedBusiness: [], unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [] }, notes: [], playerCorrections: [], canonical: true, avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
    }];
    const result = reduceTeyvatTurn(initial, [
      command({ action: 'push', root: '任务', path: 'active', evidence: '骑士团发布了侦察委托', value: {
        id: 'quest_bad', title: '坏任务', description: '', source: 'side', status: 'active', createdAtTurn: 1, updatedAt: 1,
        objectives: [{ id: 'bad', type: 'talk', description: '', targetCount: 0, currentCount: 3, completed: 'yes' }], rewards: [7],
      } }),
      command({ action: 'push', root: 'NPC', path: '[id=npc_amber].sharedMemories', evidence: '安柏认真地点了点头', value: { id: 'bad memory', turn: -1, summary: '', relatedNpcIds: 'bad' } }),
      command({ action: 'set', root: 'NPC', path: '[id=npc_amber].matureArchive', evidence: '安柏认真地点了点头', value: { ageConfirmation: 'child', preferences: 'bad' } }),
    ], { factCandidates: facts });
    expect(result.status).toBe('rejected');
    expect(result.nextState).toBe(initial);
    expect(result.errors.map((error) => error.code)).toEqual(['INVALID_VALUE', 'INVALID_VALUE', 'INVALID_VALUE']);
  });

  it('rejects non-active or temporally inconsistent active quests and malformed known mature fields atomically', () => {
    const initial = createEmptyTeyvatGameState();
    initial.NPC = [{
      id: 'npc_amber', 姓名: '安柏', 地区: '', 身份: '', 天赋: [], 说明: '', aliases: [], roleTier: 'companion', affinity: 0,
      relationship: '', intimate: false, travelingTogether: false, firstSeenTurn: 1, lastSeenTurn: 1, gender: '女', playerAddress: '', appearance: '', clothing: '', speechStyle: '', personality: '', equipmentSummary: '', sharedMemories: [], relationshipLedger: { recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [], unfinishedBusiness: [], unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [] }, notes: [], playerCorrections: [], canonical: true, avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
    }];
    const quest = (overrides: Record<string, unknown>) => ({
      id: 'quest_bad', title: '时序错误', description: '', source: 'side', status: 'active', createdAtTurn: 4, updatedAt: 4,
      objectives: [], rewards: ['物品:原石:1'], ...overrides,
    });
    const mature = (overrides: Record<string, unknown>) => ({
      enabled: true, ageConfirmation: 'adult', preferences: [], sensitivePoints: [], taboos: [],
      femaleBodyProfile: {}, maleBodyProfile: {}, experiences: [], longTermFacts: [], tags: [], partImages: {}, ...overrides,
    });
    const result = reduceTeyvatTurn(initial, [
      command({ action: 'push', root: '任务', path: 'active', evidence: '骑士团发布了侦察委托', value: quest({ status: 'completed' }) }),
      command({ action: 'push', root: '任务', path: 'active', evidence: '骑士团发布了侦察委托', value: quest({ id: 'quest_fraction', updatedAt: 4.5 }) }),
      command({ action: 'push', root: '任务', path: 'active', evidence: '骑士团发布了侦察委托', value: quest({ id: 'quest_order', updatedAt: 3 }) }),
      command({ action: 'push', root: '任务', path: 'active', evidence: '骑士团发布了侦察委托', value: quest({ id: 'quest_completed_marker', completedAtTurn: 4 }) }),
      command({ action: 'set', root: 'NPC', path: '[id=npc_amber].matureArchive', evidence: '安柏认真地点了点头', value: mature({ intimacyStage: 3 }) }),
      command({ action: 'set', root: 'NPC', path: '[id=npc_amber].matureArchive', evidence: '安柏认真地点了点头', value: mature({ boundaries: ['不得触碰'] }) }),
      command({ action: 'set', root: 'NPC', path: '[id=npc_amber].matureArchive', evidence: '安柏认真地点了点头', value: mature({ notes: false }) }),
    ], { factCandidates: facts });
    expect(result.status).toBe('rejected');
    expect(result.nextState).toBe(initial);
    expect(result.errors.map((error) => error.code)).toEqual(Array(7).fill('INVALID_VALUE'));
  });

  it('accumulates repeated stackable narrative item gains within and across batches', () => {
    const initial = createEmptyTeyvatGameState();
    const itemFacts = [
      { type: 'item' as const, action: 'gain' as const, category: 'material' as const, name: '晶核', quantity: 2, rarity: 3 as const, stackable: true, evidence: '安柏递来一份煎蛋' },
      { type: 'item' as const, action: 'gain' as const, category: 'material' as const, name: '晶核', quantity: 3, rarity: 3 as const, stackable: true, evidence: '安柏递来一份煎蛋' },
    ];
    const firstCommands = factsToTeyvatDomainCommands(itemFacts, initial, 1).commands;
    const first = reduceTeyvatTurn(initial, firstCommands, { factCandidates: facts });
    expect(first.status).toBe('accepted');
    expect(first.nextState.背包.items).toHaveLength(1);
    expect(first.nextState.背包.items[0].quantity).toBe(5);
    const secondCommands = factsToTeyvatDomainCommands([itemFacts[1]], first.nextState, 2).commands;
    const second = reduceTeyvatTurn(first.nextState, secondCommands, { factCandidates: facts });
    expect(second.status).toBe('accepted');
    expect(second.nextState.背包.items[0].quantity).toBe(8);
  });
});

describe('commitTeyvatTurn', () => {
  it('replaces exactly once when accepted and zero times when rejected', () => {
    const acceptedReplace = vi.fn();
    const accepted = commitTeyvatTurn(createEmptyTeyvatGameState(), [command()], acceptedReplace, { factCandidates: facts });
    expect(accepted.status).toBe('committed');
    expect(acceptedReplace).toHaveBeenCalledTimes(1);

    const rejectedReplace = vi.fn();
    const rejected = commitTeyvatTurn(createEmptyTeyvatGameState(), [command({ evidence: '无' })], rejectedReplace, { factCandidates: facts });
    expect(rejected.status).toBe('rejected');
    expect(rejectedReplace).not.toHaveBeenCalled();
  });

  it('reports callback failure without pretending the transaction committed', () => {
    const result = commitTeyvatTurn(createEmptyTeyvatGameState(), [command()], () => {
      throw new Error('replace failed');
    }, { factCandidates: facts });
    expect(result.status).toBe('commit_failed');
    expect(result.errors[0]?.code).toBe('COMMIT_FAILED');
  });
});

describe('post-commit effects', () => {
  it('passes only the committed state/public facts to background and autosave in order', async () => {
    const initial = createEmptyTeyvatGameState();
    const committed = reduceTeyvatTurn(initial, [command()], { factCandidates: facts });
    expect(committed.status).toBe('accepted');
    const seen: string[] = [];
    await runCommittedTurnEffects({
      committedState: committed.nextState,
      publicFacts: facts,
      runBackground: async (state, publicFacts) => {
        expect(state).toBe(committed.nextState);
        expect(state).not.toBe(initial);
        expect(publicFacts).toBe(facts);
        seen.push('background');
        return state;
      },
      autosave: async (state) => {
        expect(state).toBe(committed.nextState);
        seen.push('autosave');
      },
    });
    expect(seen).toEqual(['background', 'autosave']);
  });
});

describe('skill_used talent growth', () => {
  const skillFact = [{ domain: 'system' as const, fact: '旅行者施展风涡剑', evidence: '正文写明旅行者挥出风涡剑' }];

  const stateWithTalent = (level: number) => {
    const base = createEmptyTeyvatGameState();
    return {
      ...base,
      旅行者: {
        ...base.旅行者,
        天赋: [{ id: 'talent_gust', 名称: '风涡剑', 类别: 'elemental_skill' as const, 关联元素: 'anemo' as const, 等级: level, 说明: '牵引敌人' }],
      },
    };
  };

  it('translates a skill_used fact into an add command for the registered talent', () => {
    const { commands, warnings } = factsToTeyvatDomainCommands(
      [{ type: 'skill_used' as const, talentName: '风涡剑', evidence: '正文写明旅行者挥出风涡剑' }],
      stateWithTalent(3),
      2,
    );
    expect(warnings).toEqual([]);
    expect(commands).toEqual([expect.objectContaining({
      action: 'add', root: '旅行者', path: '天赋[id=talent_gust].等级', value: 1,
    })]);
  });

  it('warns and skips when the talent is not registered or already maxed', () => {
    const unknown = factsToTeyvatDomainCommands(
      [{ type: 'skill_used' as const, talentName: '不存在的技能', evidence: '证据' }],
      stateWithTalent(3),
      2,
    );
    expect(unknown.commands).toEqual([]);
    expect(unknown.warnings[0]).toContain('没有登记');

    const maxed = factsToTeyvatDomainCommands(
      [{ type: 'skill_used' as const, talentName: '风涡剑', evidence: '证据' }],
      stateWithTalent(20),
      2,
    );
    expect(maxed.commands).toEqual([]);
    expect(maxed.warnings[0]).toContain('最高等级');
  });

  it('applies the level increment through the transaction and clamps at 20', () => {
    const initial = stateWithTalent(3);
    const result = reduceTeyvatTurn(initial, [
      command({ action: 'add', root: '旅行者', path: '天赋[id=talent_gust].等级', value: 1, evidence: '正文写明旅行者挥出风涡剑' }),
    ], { factCandidates: skillFact });
    expect(result.status).toBe('accepted');
    expect(result.nextState.旅行者.天赋[0].等级).toBe(4);
    expect(initial.旅行者.天赋[0].等级).toBe(3);

    const bumped = reduceTeyvatTurn(stateWithTalent(19), [
      command({ action: 'add', root: '旅行者', path: '天赋[id=talent_gust].等级', value: 1, evidence: '正文写明旅行者挥出风涡剑' }),
    ], { factCandidates: skillFact });
    expect(bumped.status).toBe('accepted');
    expect(bumped.nextState.旅行者.天赋[0].等级).toBe(20);

    const over = reduceTeyvatTurn(stateWithTalent(20), [
      command({ action: 'add', root: '旅行者', path: '天赋[id=talent_gust].等级', value: 1, evidence: '正文写明旅行者挥出风涡剑' }),
    ], { factCandidates: skillFact });
    expect(over.status).toBe('rejected');
    expect(over.errors[0]?.code).toBe('INVALID_NUMERIC_RESULT');
  });
});
