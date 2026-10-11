import { describe, expect, it, vi } from 'vitest';
import { 创建默认游戏设置, type API配置项 } from '@/models/settings';
import { 创建空记忆系统 } from '@/models/memory';
import type { TeyvatItem } from '@/models/teyvat/items';
import { createEmptyTeyvatGameState, type TeyvatGameState } from '@/models/teyvat/state';
import type { FactCandidate } from '@/models/teyvat/narrativeTurn';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import { commitTeyvatTurn, reduceTeyvatTurn } from '@/services/teyvatTurnTransaction';
import { mapTeyvatNpcsToLegacy } from '@/hooks/useGameState';
import { runVariableSettlementWorkflow } from '@/hooks/useGame/variableSettlementWorkflow';
import {
  deriveNarrativeTimeFact,
  derivePartyPresenceFacts,
  factsToTeyvatDomainCommands,
  mergeNarrativeInventoryFacts,
  deriveNarrativeInventoryGainFacts,
  deriveNarrativeInventoryRemovalFacts,
  resolveTurnTimeFact,
} from '@/utils/variableFacts';
import { rebaseSettlementState, SETTLEMENT_OWNED_NARRATIVE_FIELDS } from '@/utils/settlementRebase';
import { mergeSettlementSliceWriteBack, rebaseStoryProgressMemory, type SettlementMemoryLike } from '@/utils/npcWriteBack';

const variableModel = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@/services/ai/variableModel', () => ({ callVariableModel: variableModel.call }));

/**
 * 第 3 批（核心结算一致性）的行为契约：B06 / B07 / B10 / B11 / B12 / B13 / B14。
 *
 * 每个用例都是**先在当前实现上失败**、再做最小修复转绿的反例。
 */

function moment(settlementId: string, turn: number): WorldMoment {
  return {
    worldName: '提瓦特', date: '旅行历 1000.03.07', clock: '11:00', weather: '晴',
    location: '蒙德城', travelDay: 1, turn, settlementId,
  };
}

/** 测试用的同伴档案：字段集合与 legacy `NPC记录` 一致（`同行` / `好感度` / `同行记忆`）。 */
interface TestRecord {
  id: string;
  姓名: string;
  好感度: number;
  同行: boolean;
  最近互动?: string;
  介绍?: string;
  同行记忆?: Array<{ id: string }>;
}

function record(id: string, overrides: Partial<TestRecord> = {}): TestRecord {
  return { 姓名: id, 好感度: 10, 同行: true, 同行记忆: [], ...overrides, id };
}

function memoryLedger(overrides: Partial<SettlementMemoryLike> & { 即时记忆: string[] }): SettlementMemoryLike {
  return overrides;
}

function withPartyNpc(affinity = 100, name = '安柏'): TeyvatGameState {
  const state = createEmptyTeyvatGameState();
  state.世界.当前日期 = '旅行历 1000.03.07';
  state.世界.当前时间 = '10:00';
  state.世界.旅程天数 = 1;
  state.NPC = [{
    id: 'npc_amber', 姓名: name, aliases: [], 地区: '', 身份: '', 天赋: [], 说明: '', roleTier: 'companion',
    affinity, relationship: 'friend', intimate: false, travelingTogether: true, firstSeenTurn: 1, lastSeenTurn: 1,
    gender: '女', playerAddress: '', appearance: '', clothing: '', speechStyle: '', personality: '',
    equipmentSummary: '', sharedMemories: [], relationshipLedger: {
      recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [],
      unfinishedBusiness: [], unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [],
    },
    notes: [], playerCorrections: [], canonical: true, avatar: '',
    visualArchive: { slotImages: {} }, matureArchive: null,
  }];
  return state;
}

function commitNarrative(state: TeyvatGameState, facts: Parameters<typeof factsToTeyvatDomainCommands>[0], body = '') {
  const translated = factsToTeyvatDomainCommands(facts, state, 2);
  // 与 `variableSettlementWorkflow` 同口径：正文本身是可信证据来源（lenient 模式）。
  const committed = commitTeyvatTurn(state, translated.commands, () => undefined, {
    lenientEvidence: true,
    ...(body ? { trustedEvidence: [body] } : {}),
  });
  if (committed.status !== 'committed') throw new Error(`not committed: ${JSON.stringify(committed)}`);
  return { translated, next: committed.nextState };
}

// ─────────────────────────────────────────────────────────────────────────────
// B06：等待变量时编辑剧情，会丢失当前世界时刻
// ─────────────────────────────────────────────────────────────────────────────
describe('B06 结算专属叙事子字段的合并规则', () => {
  const 玩家编辑 = { plotNodes: [{ id: 'node_player' }] as never };

  it('等待期间的剧情编辑被保留，本回合唯一的 lastCommittedMoment 也要提交', () => {
    const ancestor = createEmptyTeyvatGameState();
    ancestor.叙事 = { ...ancestor.叙事, lastCommittedMoment: moment('old', 6) };
    // 玩家在变量请求在途时编辑了剧情（叙事切片换了引用，但只动了剧情节点）
    const current = { ...ancestor, 叙事: { ...ancestor.叙事, ...玩家编辑 } };
    // 本回合结算产出：新时刻 + 新变量批次
    const next = {
      ...ancestor,
      turnCount: ancestor.turnCount + 1,
      叙事: {
        ...ancestor.叙事,
        lastCommittedMoment: moment('turn-7', 7),
        variableBatches: [{ id: 'vbatch_turn-7' } as never],
      },
    };

    const result = rebaseSettlementState({ ancestor, current, next });

    expect(result.state.叙事.lastCommittedMoment?.settlementId).toBe('turn-7');
    expect(result.state.叙事.lastCommittedMoment?.turn).toBe(7);
    expect(result.state.叙事.plotNodes).toEqual(玩家编辑.plotNodes);
    expect(result.state.叙事.variableBatches.map((batch) => batch.id)).toContain('vbatch_turn-7');
    // 玩家的剧情编辑照样要如实上报
    expect(result.preservedSlices).toEqual(['叙事']);
    expect(SETTLEMENT_OWNED_NARRATIVE_FIELDS).toContain('lastCommittedMoment');
  });

  it('结算专属子字段本身不算「玩家改动」，没有玩家编辑时不报冲突', () => {
    const ancestor = createEmptyTeyvatGameState();
    ancestor.叙事 = { ...ancestor.叙事, lastCommittedMoment: moment('old', 6) };
    const current = ancestor;
    const next = {
      ...ancestor,
      叙事: { ...ancestor.叙事, lastCommittedMoment: moment('turn-7', 7), variableBatches: [{ id: 'vbatch_turn-7' } as never] },
    };

    const result = rebaseSettlementState({ ancestor, current, next });

    expect(result.preservedSlices).toEqual([]);
    expect(result.state.叙事.lastCommittedMoment?.settlementId).toBe('turn-7');
  });

  it('同一 settlementId 重放是幂等的：时刻与批次都不重复', () => {
    const ancestor = createEmptyTeyvatGameState();
    ancestor.叙事 = { ...ancestor.叙事, lastCommittedMoment: moment('old', 6) };
    const current = { ...ancestor, 叙事: { ...ancestor.叙事, ...玩家编辑 } };
    const next = {
      ...ancestor,
      叙事: { ...ancestor.叙事, lastCommittedMoment: moment('turn-7', 7), variableBatches: [{ id: 'vbatch_turn-7' } as never] },
    };

    const first = rebaseSettlementState({ ancestor, current, next });
    const replay = rebaseSettlementState({ ancestor, current: first.state, next });

    expect(replay.state.叙事.lastCommittedMoment?.settlementId).toBe('turn-7');
    expect(replay.state.叙事.variableBatches.map((batch) => batch.id)).toEqual(['vbatch_turn-7']);
    expect(replay.state.叙事.plotNodes).toEqual(玩家编辑.plotNodes);
  });

  it('剧情编织（storyWeaving）也属于玩家编辑，必须保留', () => {
    const ancestor = createEmptyTeyvatGameState();
    ancestor.叙事 = { ...ancestor.叙事, lastCommittedMoment: moment('old', 6) };
    const weaving = { 当前系列ID: 'series_player' } as never;
    const current = { ...ancestor, 叙事: { ...ancestor.叙事, storyWeaving: weaving } };
    const next = {
      ...ancestor,
      叙事: { ...ancestor.叙事, lastCommittedMoment: moment('turn-7', 7), variableBatches: [{ id: 'vbatch_turn-7' } as never] },
    };

    const result = rebaseSettlementState({ ancestor, current, next });

    expect(result.state.叙事.storyWeaving).toEqual(weaving);
    expect(result.state.叙事.lastCommittedMoment?.settlementId).toBe('turn-7');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B07：结算后档案整理仍可能覆盖刚做的同伴/记忆修改
// ─────────────────────────────────────────────────────────────────────────────
describe('B07 提交点读取 live 的档案/记忆整理', () => {
  it('真实 NPC 映射重建对象时不能误报并发或丢失补全与压缩总结', () => {
    const root = withPartyNpc();
    const base = mapTeyvatNpcsToLegacy(root);
    const live = mapTeyvatNpcsToLegacy(root);
    const next = base.map((npc) => ({ ...npc, 介绍: '补全的简介', 总结记忆: [{ id: 'summary_1', 摘要: '本回合压缩总结' }] }));
    expect(live[0]).not.toBe(base[0]);
    const merged = mergeSettlementSliceWriteBack({ base, next, current: live });
    expect(merged.records[0]?.介绍).toBe('补全的简介');
    expect(merged.records[0]?.总结记忆?.map((item) => item.id)).toEqual(['summary_1']);
    expect(merged.concurrentRecordIds).toEqual([]);
  });

  it('编辑简介时仍提交未冲突的压缩结果，不保留已压缩来源', () => {
    const base = [{ ...record('amber'), 同行记忆: [{ id: 'old' }], 总结记忆: [] as Array<{ id: string }> }];
    const next = [{ ...base[0]!, 同行记忆: [], 总结记忆: [{ id: 'summary_1' }] }];
    const live = [{ ...base[0]!, 介绍: '玩家修改', 同行记忆: [{ id: 'old' }, { id: 'player_added' }] }];
    const merged = mergeSettlementSliceWriteBack({ base, next, current: live });
    expect(merged.records[0]?.介绍).toBe('玩家修改');
    expect(merged.records[0]?.同行记忆?.map((item) => item.id)).toEqual(['player_added']);
    expect(merged.records[0]?.总结记忆?.map((item) => item.id)).toEqual(['summary_1']);
  });

  it('压缩来源被编辑时推迟压缩，保留修改且不提交陈旧总结', () => {
    const base = [{ ...record('amber'), 同行记忆: [{ id: 'old', 摘要: '原文' }], 总结记忆: [] as Array<{ id: string }> }];
    const next = [{ ...base[0]!, 同行记忆: [], 总结记忆: [{ id: 'summary_1' }] }];
    const live = [{ ...base[0]!, 同行记忆: [{ id: 'old', 摘要: '玩家修改' }] }];
    const merged = mergeSettlementSliceWriteBack({ base, next, current: live });
    expect(merged.records[0]?.同行记忆).toEqual([{ id: 'old', 摘要: '玩家修改' }]);
    expect(merged.records[0]?.总结记忆).toEqual([]);
  });

  it('延迟压缩期间玩家改了同伴资料：玩家的改动与本回合压缩同时保留', () => {
    const base = [record('npc_amber', { 好感度: 100, 最近互动: '结算前' })];
    // 本回合整理（压缩）产出的记录
    const produced = [record('npc_amber', { 好感度: 100, 最近互动: '结算前', 同行记忆: [{ id: 'compressed_1' }] })];
    // 等待期间玩家手改了档案
    const live = [record('npc_amber', { 好感度: 100, 最近互动: '玩家手改', 介绍: '玩家写的简介' })];

    const merged = mergeSettlementSliceWriteBack({ base, next: produced, current: live });

    expect(merged.records[0]!.最近互动).toBe('玩家手改');
    expect(merged.records[0]!.介绍).toBe('玩家写的简介');
    expect(merged.records[0]!.同行记忆?.map((item) => item.id)).toEqual(['compressed_1']);
    expect(merged.concurrentRecordIds).toEqual(['npc_amber']);
  });

  it('压缩与 story-progress 写入叠加时，仍然保留等待期间新增的记忆', () => {
    const base = [record('npc_amber', { 同行记忆: [{ id: 'old' }] })];
    const produced = [record('npc_amber', {
      同行记忆: [{ id: 'old' }, { id: 'npc_story_progress_1' }],
    })];
    const live = [record('npc_amber', { 同行记忆: [{ id: 'old' }, { id: 'player_added' }] })];

    const merged = mergeSettlementSliceWriteBack({ base, next: produced, current: live });

    expect(merged.records[0]!.同行记忆?.map((item) => item.id)).toEqual(['old', 'player_added', 'npc_story_progress_1']);
  });

  it('没人动过这份档案时，整理结果照常落地（不因为加了保护就丢结算）', () => {
    const base = [record('npc_amber', { 最近互动: '结算前' })];
    const produced = [record('npc_amber', { 最近互动: '结算后' })];
    const merged = mergeSettlementSliceWriteBack({ base, next: produced, current: base });

    expect(merged.records[0]!.最近互动).toBe('结算后');
    expect(merged.concurrentRecordIds).toEqual([]);
  });

  it('本回合新建与删除的档案也照常落地，且不复活活体里删掉的人', () => {
    const base = [record('npc_amber'), record('npc_gone', { 同行: false })];
    const produced = [record('npc_amber'), record('npc_new')];
    const live = [record('npc_amber'), record('npc_other')];

    const merged = mergeSettlementSliceWriteBack({ base, next: produced, current: live });

    expect(merged.records.map((item) => item.id)).toEqual(['npc_amber', 'npc_other', 'npc_new']);
  });

  it('剧情进度记忆只补本回合新增的那条，玩家的其它记忆与归档不被回退', () => {
    const base = memoryLedger({ 即时记忆: ['旧'], 即时记忆ID: ['memory_1'] });
    const produced = memoryLedger({ 即时记忆: ['旧', '剧情编织进度：新章'], 即时记忆ID: ['memory_1', 'memory_story_turn-7'], 来源时刻: { 'memory_story_turn-7': { start: moment('turn-7', 7), end: moment('turn-7', 7), sourceIds: ['memory_story_turn-7'] } } });
    const live = memoryLedger({ 即时记忆: ['旧', '玩家手动添加'], 即时记忆ID: ['memory_1', 'memory_player'] });

    const merged = rebaseStoryProgressMemory({ base, next: produced, current: live });

    expect(merged.applied).toBe(true);
    expect(merged.memory.即时记忆).toEqual(['旧', '玩家手动添加', '剧情编织进度：新章']);
    expect(merged.memory.来源时刻?.['memory_story_turn-7']).toBeDefined();
  });

  it('同一条剧情进度记忆重放不会写第二遍', () => {
    const base = memoryLedger({ 即时记忆: ['旧'], 即时记忆ID: ['memory_1'] });
    const produced = memoryLedger({ 即时记忆: ['旧', '剧情编织进度：新章'], 即时记忆ID: ['memory_1', 'memory_story_turn-7'] });
    const first = rebaseStoryProgressMemory({ base, next: produced, current: base });
    const replay = rebaseStoryProgressMemory({ base, next: produced, current: first.memory });

    expect(replay.applied).toBe(false);
    expect(replay.memory.即时记忆).toEqual(['旧', '剧情编织进度：新章']);
  });

  it('本回合没有新增记忆时不动活体记忆（不做整份重放）', () => {
    const base = memoryLedger({ 即时记忆: ['旧'], 即时记忆ID: ['memory_1'] });
    const live = memoryLedger({ 即时记忆: ['旧', '玩家手动添加'], 即时记忆ID: ['memory_1', 'memory_player'] });
    const merged = rebaseStoryProgressMemory({ base, next: base, current: live });

    expect(merged.applied).toBe(false);
    expect(merged.memory).toBe(live);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B10：多段相对时间只取最后一段
// ─────────────────────────────────────────────────────────────────────────────
describe('B10 多段相对时间累加', () => {
  it('「三天后…两个小时后」累计四天两小时，而不是只加 120 分钟', () => {
    const state = withPartyNpc();
    const fact = deriveNarrativeTimeFact('三天后，队伍抵达璃月港。两个小时后，他们继续赶路。', '10:00');
    expect(fact).not.toBeNull();
    const { next } = commitNarrative(state, [fact!]);

    expect(next.世界.旅程天数).toBe(1 + 3);
    expect(next.世界.当前日期).toBe('旅行历 1000.03.10');
    expect(next.世界.当前时间).toBe('12:00');
    expect(next.NPC[0]!.affinity).toBe(100 + 3 * 10);
  });

  it('绝对钟点与累计跨度混排时按叙事顺序结算', () => {
    const state = withPartyNpc();
    const fact = deriveNarrativeTimeFact('三天后，队伍在 22:00 抵达驿站。两个小时后，他们继续赶路。', '10:00');
    // 10:00 + 3 天 = 第 4 天 10:00 → 22:00（+12h）→ +2h = 次日 00:00 = 第 5 天
    expect(fact).toMatchObject({ mode: 'elapsed', minutes: 3 * 1440 + 12 * 60 + 120 });
    const { next } = commitNarrative(state, [fact!]);

    expect(next.世界.旅程天数).toBe(1 + 4);
    expect(next.世界.当前日期).toBe('旅行历 1000.03.11');
    expect(next.世界.当前时间).toBe('00:00');
  });

  it('纯绝对钟点仍按钟点处理（同日 set_time，不凭空加时）', () => {
    const state = withPartyNpc();
    const fact = deriveNarrativeTimeFact('傍晚六点，队伍回到蒙德城。', '10:00');
    expect(fact).toMatchObject({ mode: 'set_time', targetTime: '18:00' });
    const { next } = commitNarrative(state, [fact!]);
    expect(next.世界.当前时间).toBe('18:00');
    expect(next.世界.旅程天数).toBe(1);
  });

  it('同一跨度重述不叠加（「两个小时后」说两遍只加 120 分钟）', () => {
    const state = withPartyNpc();
    const fact = deriveNarrativeTimeFact('两个小时后，队伍抵达营地。两个小时后，他们点起了篝火。', '10:00');
    const { next } = commitNarrative(state, [fact!]);

    expect(next.世界.当前时间).toBe('12:00');
    expect(next.世界.旅程天数).toBe(1);
  });

  it('跨日之后赶路要同时体现（日期、钟点、旅行天数三者一致）', () => {
    const decided = resolveTurnTimeFact('三天后，队伍出发，两个小时后抵达驿站。', '10:00');
    expect(decided.warning).toBeNull();
    expect(decided.fact?.mode).toBe('elapsed');
    expect((decided.fact as { minutes?: number } | null)?.minutes).toBe(3 * 1440 + 120);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B11：「安柏没有离开队伍」仍生成 following=false
// ─────────────────────────────────────────────────────────────────────────────
describe('B11 离队判定的否定/意图/归属校验', () => {
  const party = [{ id: 'npc_amber', 姓名: '安柏', 同行: true }];

  it('没有离队：不产生 following=false', () => {
    expect(derivePartyPresenceFacts('安柏没有离开队伍，她只是去取回箭袋。', party)).toEqual([]);
    expect(derivePartyPresenceFacts('安柏并未离开队伍。', party)).toEqual([]);
  });

  it('不再离队：不产生 following=false', () => {
    expect(derivePartyPresenceFacts('安柏决定不再离开队伍。', party)).toEqual([]);
    expect(derivePartyPresenceFacts('安柏打消了离队的念头。', party)).toEqual([]);
  });

  it('决定离队但尚未执行：不产生 following=false', () => {
    expect(derivePartyPresenceFacts('安柏打算离开队伍。', party)).toEqual([]);
    expect(derivePartyPresenceFacts('安柏考虑离队，但还没有决定。', party)).toEqual([]);
  });

  it('真实离队：仍然产生 following=false', () => {
    const facts = derivePartyPresenceFacts('安柏离开了队伍，独自向北走去。', party);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ id: 'npc_amber', following: false });
    expect(derivePartyPresenceFacts('安柏告别队伍，不再同行。', party)).toHaveLength(1);
  });

  it('模型给出的正确 following=true 不会被系统事实整条滤掉', () => {
    const state = withPartyNpc();
    // 模型正确报了同行，并且另外给了一份好感增量
    const modelFacts = [{ type: 'npc' as const, id: 'npc_amber', name: '安柏', following: true, affinityDelta: 2, evidence: '安柏与旅行者一起赶路。' }];
    const presence = derivePartyPresenceFacts('安柏没有离开队伍。', state.NPC.map((npc) => ({
      id: npc.id, 姓名: npc.姓名, 同行: npc.travelingTogether,
    })));
    expect(presence).toEqual([]);
    const presenceNames = new Set(presence.map((fact) => fact.name));
    const kept = modelFacts.filter((fact) => fact.type !== 'npc'
      || !presenceNames.has(fact.name)
      || typeof fact.following !== 'boolean');

    expect(kept).toEqual(modelFacts);
    expect(kept[0]!.following).toBe(true);
  });

  it('真实离队时，模型自报的 following=true 仍以正文为准', () => {
    const state = withPartyNpc();
    const modelFacts = [{ type: 'npc' as const, id: 'npc_amber', name: '安柏', following: true, affinityDelta: 2, evidence: '安柏与旅行者一起赶路。' }];
    const departure = derivePartyPresenceFacts('安柏离开了队伍。', [{ id: 'npc_amber', 姓名: '安柏', 同行: true }]);
    expect(departure).toHaveLength(1);
    // 工作流的过滤规则：只有系统**真的判定离队**的角色，模型的 following 才被覆盖。
    const presenceIds = new Set(departure.map((fact) => fact.id));
    const kept = modelFacts.filter((fact) => !presenceIds.has(fact.id));
    const translated = factsToTeyvatDomainCommands([...kept, ...departure], state, 2);
    const following = translated.commands.filter((command) => command.path.endsWith('.travelingTogether'));
    expect(following).toHaveLength(1);
    expect(following[0]).toMatchObject({ value: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B12：中文复合数量「十二/二十枚苹果」变成 1
// ─────────────────────────────────────────────────────────────────────────────
describe('B12 中文复合数量', () => {
  const 苹果: TeyvatItem[] = [{ id: 'item_apple', category: 'food', name: '苹果', description: '', quantity: 1, rarity: 1, obtainedAtTurn: 1 }];

  const cases: Array<{ text: string; quantity: number }> = [
    { text: '你获得了 12 枚苹果。', quantity: 12 },
    { text: '你获得了十二枚苹果。', quantity: 12 },
    { text: '你获得了二十枚苹果。', quantity: 20 },
    { text: '你获得了一百零一枚苹果。', quantity: 101 },
  ];
  for (const { text, quantity } of cases) {
    it(`「${text}」解析成 ${quantity}`, () => {
      const { facts } = deriveNarrativeInventoryGainFacts(text, 苹果);
      expect(facts).toHaveLength(1);
      expect(facts[0]).toMatchObject({ name: '苹果', quantity });
    });
  }

  it('获得与消耗共用同一个解析器（移除「二十枚」不会只扣 1）', () => {
    const removal = deriveNarrativeInventoryRemovalFacts('你使用二十枚苹果。', [
      { ...苹果[0]!, quantity: 50 },
    ]);
    expect(removal).toHaveLength(1);
    expect(removal[0]).toMatchObject({ action: 'consume', name: '苹果', quantity: 20 });
  });

  it('「移除剩余数量」仍然封顶在背包实际数量上', () => {
    const removal = deriveNarrativeInventoryRemovalFacts('你使用二十枚苹果。', [
      { ...苹果[0]!, quantity: 5 },
    ]);
    expect(removal[0]!.quantity).toBe(5);
  });

  it('未标注数量的获得仍然按 1 处理', () => {
    const facts = mergeNarrativeInventoryFacts([], deriveNarrativeInventoryGainFacts('你接过苹果。', 苹果).facts);
    const gained = facts.filter((fact) => fact.type === 'item');
    expect(gained[0]).toMatchObject({ quantity: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B13：本回合先离队再跨三天，已离队人物仍拿三天同行奖励
// ─────────────────────────────────────────────────────────────────────────────
describe('B13 每日同行奖励按有序投影发放', () => {
  function 三人() {
    const state = withPartyNpc(100, '安柏');
    state.NPC = [
      ...state.NPC,
      { ...state.NPC[0]!, id: 'npc_kaeya', 姓名: '凯亚', aliases: [] },
      { ...state.NPC[0]!, id: 'npc_lisa', 姓名: '丽莎', aliases: [] },
    ];
    return state;
  }

  it('本回合先离队再跨日：离队者不拿奖励，仍同行的人照拿', () => {
    const state = 三人();
    const body = '凯亚离开了队伍，独自向北走去。三天后，队伍抵达营地。';
    const time = deriveNarrativeTimeFact('三天后，队伍抵达营地。', '10:00')!;
    const departure = derivePartyPresenceFacts(body, [
      { id: 'npc_kaeya', 姓名: '凯亚', 同行: true },
    ]);
    expect(departure).toHaveLength(1);
    // 命令层：离队事实（following=false）排在时间事实之前 → 该角色不该拿跨日奖励。
    const translated = factsToTeyvatDomainCommands([...departure, time], state, 2);
    // 反向证据：旧实现（只看 state.NPC）会给离队者同样一份三天奖励命令。
    const kaeya = translated.commands.filter((command) => command.path === '[id=npc_kaeya].travelingTogether');
    expect(kaeya).toHaveLength(1);
    expect(kaeya[0]).toMatchObject({ value: false });
    for (const id of ['npc_amber', 'npc_lisa']) {
      const affinity = translated.commands.filter((command) => command.path === `[id=${id}].affinity`);
      expect(affinity).toHaveLength(1);
      expect(affinity[0]).toMatchObject({ action: 'add', value: 3 * 10 });
    }

    const { next } = commitNarrative(state, [...departure, time], body);

    const byId = new Map(next.NPC.map((npc) => [npc.id, npc]));
    expect(byId.get('npc_kaeya')!.affinity).toBe(100);
    expect(byId.get('npc_kaeya')!.travelingTogether).toBe(false);
    expect(byId.get('npc_amber')!.affinity).toBe(130);
    expect(byId.get('npc_lisa')!.affinity).toBe(130);
  });

  it('本回合先入队再跨日：入队者按本回合同行结算', () => {
    const state = 三人();
    state.NPC = state.NPC.map((npc) => npc.id === 'npc_lisa' ? { ...npc, travelingTogether: false } : npc);
    const body = '丽莎加入了队伍。三天后，队伍抵达营地。';
    const time = deriveNarrativeTimeFact('三天后，队伍抵达营地。', '10:00')!;
    const joining = [{ type: 'npc' as const, id: 'npc_lisa', name: '丽莎', following: true, evidence: '丽莎加入了队伍。' }];
    const translated = factsToTeyvatDomainCommands([joining[0]!, time], state, 2);
    const lisaAffinity = translated.commands.filter((command) => command.path === '[id=npc_lisa].affinity');
    expect(lisaAffinity).toHaveLength(1);
    expect(lisaAffinity[0]).toMatchObject({ action: 'add', value: 3 * 10 });
    const { next } = commitNarrative(state, [joining[0]!, time], body);

    const byId = new Map(next.NPC.map((npc) => [npc.id, npc]));
    expect(byId.get('npc_lisa')!.travelingTogether).toBe(true);
    expect(byId.get('npc_lisa')!.affinity).toBe(130);
    expect(byId.get('npc_amber')!.affinity).toBe(130);
  });

  it('跨日之后才离队：仍按本回合同行结算（顺序即语义）', () => {
    const state = 三人();
    const body = '三天后，队伍抵达营地。随后凯亚离开了队伍。';
    const time = deriveNarrativeTimeFact('三天后，队伍抵达营地。', '10:00')!;
    const departure = derivePartyPresenceFacts(body, [
      { id: 'npc_kaeya', 姓名: '凯亚', 同行: true },
    ]);
    const translated = factsToTeyvatDomainCommands([time, ...departure], state, 2);
    const kaeyaAffinity = translated.commands.filter((command) => command.path === '[id=npc_kaeya].affinity');
    expect(kaeyaAffinity).toHaveLength(1);
    expect(kaeyaAffinity[0]).toMatchObject({ action: 'add', value: 3 * 10 });
    const { next } = commitNarrative(state, [time, ...departure], body);

    const byId = new Map(next.NPC.map((npc) => [npc.id, npc]));
    expect(byId.get('npc_kaeya')!.affinity).toBe(130);
    expect(byId.get('npc_kaeya')!.travelingTogether).toBe(false);
  });

  it('跨日奖励仍然只发一次（重复的时间事实不叠加）', () => {
    const state = 三人();
    const time = deriveNarrativeTimeFact('三天后，队伍抵达营地。', '10:00')!;
    const { next } = commitNarrative(state, [time, time, time]);
    const byId = new Map(next.NPC.map((npc) => [npc.id, npc]));
    expect(byId.get('npc_amber')!.affinity).toBe(130);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B14：任务预览严格证据匹配，正式结算却 lenient
// ─────────────────────────────────────────────────────────────────────────────
describe('B14 任务预览与正式提交共用证据上下文', () => {
  function questState() {
    const state = createEmptyTeyvatGameState();
    state.世界.当前地点 = '蒙德城';
    state.任务.active = [{
      id: 'quest_patrol', title: '巡逻任务', description: '与安柏一起巡逻。', source: 'side', status: 'active',
      objectives: [{
        id: 'target_arrive', type: 'travel', description: '抵达璃月港', targetCount: 1, currentCount: 0, completed: false,
      }],
      rewards: [], createdAtTurn: 1, updatedAt: 1,
    }];
    return state;
  }

  /** 与 `variableSettlementWorkflow` 同一个证据上下文（预览与正式提交共用）。 */
  const 证据上下文 = (factCandidates: FactCandidate[] = []) => ({
    factCandidates,
    trustedEvidence: [] as string[],
    lenientEvidence: true as const,
  });

  it('证据被改写时，预览与正式结算给出同一结论（预览失败必须可见）', async () => {
    const { composeQuestSettlementCommands } = await import('@/hooks/useGame/questWorkflow');
    const state = questState();
    const narrativeCommands = [{ action: 'set' as const, root: '世界' as const, path: '当前地点', value: '璃月港', evidence: '改写过的证据句，并不逐字出现在候选里。' }];

    const composed = composeQuestSettlementCommands({
      state,
      narrativeCommands,
      enabled: true,
      questUpdates: [],
      body: '旅行者抵达了璃月港。',
      variableFacts: [],
      factCandidates: [],
      turn: 2,
      evidenceContext: 证据上下文(),
    });

    // 预览与正式提交同口径 → 预览不再误拦；任务命令与位置更新一起落地。
    expect(composed.previewErrors).toEqual([]);
    expect(composed.quest.commands.length).toBeGreaterThan(0);
    expect(composed.commands.filter((item) => item.root === '任务').length).toBeGreaterThan(0);
  });

  it('预览/正式结果一致：抵达任务计数真的从 0 走到 1', async () => {
    const { composeQuestSettlementCommands } = await import('@/hooks/useGame/questWorkflow');
    const state = questState();
    const composed = composeQuestSettlementCommands({
      state,
      narrativeCommands: [{ action: 'set', root: '世界', path: '当前地点', value: '璃月港', evidence: '旅行者抵达了璃月港。' }],
      enabled: true,
      questUpdates: [],
      body: '旅行者抵达了璃月港。',
      variableFacts: [],
      factCandidates: [],
      turn: 2,
      evidenceContext: 证据上下文(),
    });
    expect(composed.previewErrors).toEqual([]);

    const committed = commitTeyvatTurn(state, composed.commands, () => undefined, {
      factCandidates: [],
      trustedEvidence: composed.quest.commands.length ? [composed.quest.evidence] : [],
      lenientEvidence: true,
    });
    if (committed.status !== 'committed') throw new Error(JSON.stringify(committed));
    const settled = [...committed.nextState.任务.active, ...committed.nextState.任务.completed]
      .find((quest) => quest.id === 'quest_patrol');
    expect(settled?.objectives[0]!.currentCount).toBe(1);
    expect(settled?.objectives[0]!.completed).toBe(true);
  });

  it('预览失败时不再静默：命令无效则预检必须报错，任务命令不会半途丢失', async () => {
    const { composeQuestSettlementCommands } = await import('@/hooks/useGame/questWorkflow');
    const state = questState();
    const composed = composeQuestSettlementCommands({
      state,
      // 路径非法 → 预览必然失败，此时必须把错误交回调用方（而不是悄悄丢掉任务推进）
      narrativeCommands: [{ action: 'set', root: '世界', path: '当前地点.不存在', value: '璃月港', evidence: '旅行者抵达了璃月港。' }],
      enabled: true,
      questUpdates: [],
      body: '旅行者抵达了璃月港。',
      variableFacts: [],
      factCandidates: [],
      turn: 2,
      evidenceContext: 证据上下文(),
    });

    expect(composed.previewErrors.length).toBeGreaterThan(0);
    expect(composed.quest.commands).toEqual([]);
  });

  it('空候选但命令合法：预览不再把整批任务命令吞掉', () => {
    const state = questState();
    // 预览只做了与正式提交相同的替换，不额外要求候选证据
    const preview = reduceTeyvatTurn(state, [
      { action: 'set', root: '世界', path: '当前地点', value: '璃月港', evidence: '旅行者抵达了璃月港。' },
    ], 证据上下文());
    expect(preview.status).toBe('accepted');
  });

  it('端到端：正式结算里抵达任务计数真的走到 1（预览与提交同口径）', async () => {
    variableModel.call.mockReset();
    // 变量模型只给一条「改写型」证据的地点事实；任务证据最终来自正文兜底。
    variableModel.call.mockResolvedValue({
      rawText: `<变量事实>${JSON.stringify([
        { type: 'location', location: '璃月港', evidence: '队伍终于来到了繁华的璃月港。' },
      ])}</变量事实>`,
    });
    const config: API配置项 = {
      id: 'main', name: '主模型', provider: 'deepseek', baseUrl: 'https://example.invalid/v1', apiKey: 'test',
      model: 'test', maxTokens: 4096, temperature: 0.8, topP: 0.9, retryCount: 0, createdAt: 1, updatedAt: 1,
    };
    const state = questState();
    let live = state;
    const result = await runVariableSettlementWorkflow({
      mainApiConfig: config,
      currentGame: live,
      settings: 创建默认游戏设置(),
      npcRecords: mapTeyvatNpcsToLegacy(live),
      commitGame: (next) => { live = next; return true; },
      userInput: '向璃月港出发',
      body: '旅行者抵达了璃月港。',
      turnAfter: 2,
      memorySystemSnapshot: 创建空记忆系统(),
      questEnabled: true,
      settlementId: 'turn-2',
    });

    expect(live.世界.当前地点).toBe('璃月港');
    const settled = [...live.任务.active, ...live.任务.completed].find((quest) => quest.id === 'quest_patrol');
    expect(settled?.objectives[0]!.currentCount).toBe(1);
    expect(settled?.objectives[0]!.completed).toBe(true);
    // 批次报告里既没有「预览未通过」，也已经落了任务命令
    expect(result?.batch?.report ?? '').not.toContain('任务预览未通过');
    expect(result?.batch?.results.some((item) => item.command.key.startsWith('任务.'))).toBe(true);
  });

  it('端到端：预览失败会写进批次报告（不再静默）', async () => {
    variableModel.call.mockReset();
    // 非法的世界路径 → 预览必然失败；文案必须出现在批次报告里。
    variableModel.call.mockResolvedValue({
      rawText: `<变量事实>${JSON.stringify([
        { type: 'location', location: '璃月港', evidence: '旅行者抵达了璃月港。' },
      ])}</变量事实>`,
    });
    const config: API配置项 = {
      id: 'main', name: '主模型', provider: 'deepseek', baseUrl: 'https://example.invalid/v1', apiKey: 'test',
      model: 'test', maxTokens: 4096, temperature: 0.8, topP: 0.9, retryCount: 0, createdAt: 1, updatedAt: 1,
    };
    const state = questState();
    let live = state;
    const result = await runVariableSettlementWorkflow({
      mainApiConfig: config,
      currentGame: live,
      settings: 创建默认游戏设置(),
      npcRecords: mapTeyvatNpcsToLegacy(live),
      commitGame: (next) => { live = next; return true; },
      userInput: '向璃月港出发',
      // 正文里声明了一个**无效时刻** → 时间事实被拦下，预览阶段必定报错。
      body: '旅行者抵达了璃月港。钟楼显示现在是 25:70。',
      turnAfter: 2,
      memorySystemSnapshot: 创建空记忆系统(),
      questEnabled: true,
      settlementId: 'turn-3',
    });

    expect(live).toBeDefined();
    // 预览失败不再被吞掉：要么走「任务预览未通过」，要么作为事实警告可见。
    const report = result?.batch?.report ?? '';
    expect(report.includes('任务预览未通过') || report.includes('事实警告：1 条')).toBe(true);
  });
});
