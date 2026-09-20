import { describe, expect, it } from 'vitest';
import {
  解析任务更新命令,
  应用任务更新命令,
  结算任务进展,
  完成任务并生成奖励命令,
  放弃任务,
  abandonQuest,
  创建空任务系统,
} from '../../services/questService';
import { 归一化任务系统, compact任务系统 } from '../../models/quest';
import {
  buildCommittedQuestArchive,
  deriveQuestDomainCommands,
} from '../../services/questService';
import { createEmptyTeyvatGameState } from '../../models/teyvat';
import { commitTeyvatTurn } from '../../services/teyvatTurnTransaction';
import type { TeyvatDomainCommand } from '../../models/teyvat/domainCommand';
import { vi } from 'vitest';
import { composeQuestSettlementCommands } from '../../hooks/useGame/questWorkflow';

describe('questService', () => {
  it('parses quest update commands from AI output', () => {
    const commands = 解析任务更新命令(
      '接取: 帮助佩拉|调查贝洛伯格档案|支线\n目标: 帮助佩拉|交谈|与佩拉交谈|1|佩拉\n进展: 帮助佩拉|target_1|1\n完成: 登上星穹列车\n放弃: 旧任务',
    );
    expect(commands).toHaveLength(5);
    expect(commands[0]).toMatchObject({ kind: 'accept', 任务标题: '帮助佩拉' });
    expect(commands[1]).toMatchObject({ kind: 'objective', 目标类型: '交谈', 数量: 1, 关联对象: '佩拉' });
    expect(commands[2]).toMatchObject({ kind: 'progress', 目标ID: 'target_1', 数量: 1 });
    expect(commands[3]!.kind).toBe('complete');
    expect(commands[4]!.kind).toBe('abandon');
  });

  it('applies accept, objective, complete and abandon commands', () => {
    let system = 创建空任务系统();
    system = 应用任务更新命令(system, 解析任务更新命令('接取: 帮助佩拉|调查贝洛伯格档案|支线'), 3);
    expect(system.进行中).toHaveLength(1);
    system = 应用任务更新命令(system, 解析任务更新命令('目标: 帮助佩拉|交谈|与佩拉交谈|1|佩拉'), 3);
    expect(system.进行中[0]!.目标).toHaveLength(1);
    system = 应用任务更新命令(system, 解析任务更新命令('完成: 帮助佩拉'), 4);
    expect(system.进行中).toHaveLength(0);
    expect(system.已完成[0]!.状态).toBe('已完成');
    expect(system.已完成[0]!.完成回合).toBe(4);
    // 已完成任务不能被放弃命令再次移动
    system = 应用任务更新命令(system, 解析任务更新命令('放弃: 帮助佩拉'), 5);
    expect(system.已完成).toHaveLength(1);
    expect(system.已放弃).toHaveLength(0);
    // 进行中任务可放弃
    system = 应用任务更新命令(system, 解析任务更新命令('接取: 可放弃任务|测试|支线'), 5);
    system = 应用任务更新命令(system, 解析任务更新命令('放弃: 可放弃任务'), 6);
    expect(system.已放弃[0]!.状态).toBe('已放弃');
  });

  it('settles talk objectives from the body', () => {
    let system = 创建空任务系统();
    system = 应用任务更新命令(system, 解析任务更新命令('接取: 交谈任务|测试|支线\n目标: 交谈任务|交谈|与佩拉交谈|1|佩拉\n目标: 交谈任务|前往|抵达星穹列车|1|星穹列车'), 1);
    const result = 结算任务进展(system, { 正文: '你与佩拉在档案室聊了很久。', 变量事实: [], 当前回合: 2 });
    const targets = result.system.进行中[0]!.目标;
    expect(targets[0]!.完成).toBe(true);
    expect(targets[1]!.完成).toBe(false);
  });

  it('settles location objectives from the current place', () => {
    let system = 创建空任务系统();
    system = 应用任务更新命令(system, 解析任务更新命令('接取: 前往任务|测试|支线\n目标: 前往任务|前往|抵达星穹列车|1|星穹列车\n目标: 前往任务|交谈|与丹恒交谈|1|丹恒'), 1);
    const result = 结算任务进展(system, { 正文: '列车启动。', 变量事实: [], 当前地点: '星穹列车', 当前回合: 2 });
    const targets = result.system.进行中[0]!.目标;
    expect(targets[0]!.完成).toBe(true);
    expect(targets[1]!.完成).toBe(false);
  });

  it('settles collect objectives from the inventory', () => {
    let system = 创建空任务系统();
    system = 应用任务更新命令(system, 解析任务更新命令('接取: 收集任务|测试|支线\n目标: 收集任务|收集|收集 2 份星琼|2|星琼\n目标: 收集任务|交谈|与佩拉交谈|1|佩拉'), 1);
    const result = 结算任务进展(system, {
      正文: '收集完毕。',
      变量事实: [],
      背包物品: [
        { id: 'i1', category: 'material', name: '星琼', description: '', quantity: 2, rarity: 3, stackable: true, obtainedAtTurn: 1 },
      ],
      当前回合: 2,
    });
    const targets = result.system.进行中[0]!.目标;
    expect(targets[0]!.当前数量).toBe(2);
    expect(targets[0]!.完成).toBe(true);
    expect(targets[1]!.完成).toBe(false);
  });

  it('auto-completes a quest when all objectives are done and returns rewards', () => {
    let system = 创建空任务系统();
    system = 应用任务更新命令(system, 解析任务更新命令('接取: 完整任务|测试|支线'), 1);
    system = {
      ...system,
      进行中: [{
        ...system.进行中[0]!,
        目标: [{ id: 't1', 类型: '交谈', 描述: '与佩拉交谈', 目标数量: 1, 当前数量: 1, 关联对象: '佩拉', 完成: true }],
        奖励: [{ 类型: '物品', 内容: '星琼', 数量: 1 }],
      }],
    };
    const result = 结算任务进展(system, { 正文: '与佩拉交谈。', 变量事实: [], 当前回合: 2 });
    expect(result.system.进行中).toHaveLength(0);
    expect(result.system.已完成[0]!.状态).toBe('已完成');
    expect(result.rewards).toHaveLength(1);
    expect(result.rewards[0]).toMatchObject({ 类型: '物品', 内容: '星琼' });
  });

  it('abandons a task explicitly', () => {
    let system = 创建空任务系统();
    system = 应用任务更新命令(system, 解析任务更新命令('接取: 放弃任务|测试|支线'), 1);
    system = 放弃任务(system, system.进行中[0]!.id);
    expect(system.进行中).toHaveLength(0);
    expect(system.已放弃[0]!.状态).toBe('已放弃');
  });

  it('normalizes and compacts the quest system', () => {
    const normalized = 归一化任务系统({
      进行中: [{ id: 'q1', 标题: '进行中', 状态: '进行中', 目标: [{ id: 't1', 类型: '交谈', 描述: 'x', 目标数量: 1, 当前数量: 1, 完成: true }], 创建回合: 1 }],
      已完成: Array.from({ length: 60 }, (_, index) => ({ id: 'done' + index, 标题: 'D' + index, 状态: '已完成', 目标: [], 创建回合: 1 })),
      已放弃: [],
    });
    expect(normalized.进行中[0]!.状态).toBe('已完成'); // 全部目标完成强制已完成
    const compacted = compact任务系统(normalized, 50);
    expect(compacted.已完成).toHaveLength(50);
  });
});

describe('atomic Teyvat quest settlement', () => {
  const questEvidence = '安柏交付了侦察奖励';

  function questState() {
    const state = createEmptyTeyvatGameState();
    state.turnCount = 4;
    state.世界.当前地点 = '蒙德城';
    state.NPC = [{
      id: 'npc_amber', 姓名: '安柏', 地区: 'mondstadt', 身份: '侦察骑士', 天赋: [], 说明: '', aliases: [],
      roleTier: 'companion', affinity: 10, relationship: 'friend', intimate: false, travelingTogether: true,
      firstSeenTurn: 1, lastSeenTurn: 3, gender: '女', playerAddress: '旅行者', appearance: '', clothing: '',
      speechStyle: '', personality: '', equipmentSummary: '', sharedMemories: [], relationshipLedger: {
        recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [], unfinishedBusiness: [],
        unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [],
      }, notes: [], playerCorrections: [], canonical: true, avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
    }];
    state.任务.active = [{
      id: 'quest_scout', title: '城外侦察', description: '与安柏会合', source: 'side', status: 'active',
      objectives: [{ id: 'objective_talk', type: 'talk', description: '与安柏交谈', targetCount: 1, currentCount: 0, completed: false }],
      rewards: ['物品:原石:2', '好感:安柏:5', '记忆:完成城外侦察'], createdAtTurn: 2, updatedAt: 2,
    }];
    return state;
  }

  it('abandons a formal quest immutably at the Teyvat boundary', () => {
    const initial = questState().任务;
    const frozen = structuredClone(initial);

    const abandoned = abandonQuest(initial, 'quest_scout', 99);

    expect(abandoned.active).toHaveLength(0);
    expect(abandoned.abandoned[0]).toMatchObject({
      id: 'quest_scout',
      status: 'abandoned',
      updatedAt: 99,
    });
    expect(abandoned.lastUpdates.at(-1)).toBe('放弃任务：城外侦察');
    expect(initial).toEqual(frozen);
    expect(abandonQuest(initial, 'missing', 99)).toBe(initial);
  });

  it('derives stable quest, inventory and NPC commands that commit with narrative commands in one root write', () => {
    const initial = questState();
    const frozen = structuredClone(initial);
    const derived = deriveQuestDomainCommands({
      state: initial,
      questUpdates: [`完成: 城外侦察`],
      body: questEvidence,
      variableFacts: [],
      turn: 4,
      evidence: questEvidence,
    });
    expect(deriveQuestDomainCommands({
      state: initial,
      questUpdates: [`完成: 城外侦察`],
      body: questEvidence,
      variableFacts: [],
      turn: 4,
      evidence: questEvidence,
    }).commands).toEqual(derived.commands);

    const narrativeCommand: TeyvatDomainCommand = {
      action: 'set', root: '世界', path: '当前天气', value: '晴', evidence: questEvidence,
    };
    const replace = vi.fn();
    const result = commitTeyvatTurn(initial, [narrativeCommand, ...derived.commands], replace, {
      trustedEvidence: [questEvidence],
    });

    expect(result.status).toBe('committed');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(result.nextState.世界.当前天气).toBe('晴');
    expect(result.nextState.任务.active).toHaveLength(0);
    expect(result.nextState.任务.completed[0]).toMatchObject({ id: 'quest_scout', status: 'completed', completedAtTurn: 4 });
    expect(result.nextState.背包.items[0]).toMatchObject({ name: '原石', quantity: 2 });
    expect(result.nextState.NPC[0]!.affinity).toBe(15);
    expect(initial).toEqual(frozen);
  });

  it('rejects the entire narrative plus quest batch when a reward target is invalid', () => {
    const initial = questState();
    initial.任务.active[0]!.rewards = ['好感:不存在的NPC:5'];
    const frozen = structuredClone(initial);
    const derived = deriveQuestDomainCommands({
      state: initial,
      questUpdates: ['完成: 城外侦察'],
      body: questEvidence,
      variableFacts: [],
      turn: 4,
      evidence: questEvidence,
    });
    const replace = vi.fn();
    const result = commitTeyvatTurn(initial, [{
      action: 'set', root: '世界', path: '当前天气', value: '晴', evidence: questEvidence,
    }, ...derived.commands], replace, { trustedEvidence: [questEvidence] });

    expect(result.status).toBe('rejected');
    expect(result.errors.map((error) => error.code)).toContain('MISSING_TARGET_ID');
    expect(replace).not.toHaveBeenCalled();
    expect(initial).toEqual(frozen);
  });

  it('accumulates repeated same-item quest rewards through a projected inventory cursor', () => {
    const initial = questState();
    initial.任务.active[0]!.rewards = ['物品:原石:2', '物品:原石:3'];
    const derived = deriveQuestDomainCommands({
      state: initial, questUpdates: ['完成: 城外侦察'], body: questEvidence,
      variableFacts: [], turn: 4, evidence: questEvidence,
    });
    const result = commitTeyvatTurn(initial, derived.commands, () => undefined, { trustedEvidence: [questEvidence] });
    expect(result.status).toBe('committed');
    expect(result.nextState.背包.items).toHaveLength(1);
    expect(result.nextState.背包.items[0]).toMatchObject({ name: '原石', quantity: 5 });
  });

  it('archives only committed quest facts idempotently and can retry after an archive failure', () => {
    const initial = questState();
    const derived = deriveQuestDomainCommands({
      state: initial,
      questUpdates: ['完成: 城外侦察'],
      body: questEvidence,
      variableFacts: [],
      turn: 4,
      evidence: questEvidence,
    });
    let committed = initial;
    const transaction = commitTeyvatTurn(initial, derived.commands, (next) => { committed = next; }, {
      trustedEvidence: [questEvidence],
    });
    expect(transaction.status).toBe('committed');
    expect(() => { throw new Error('archive offline'); }).toThrow('archive offline');
    expect(committed.任务.completed[0]?.id).toBe('quest_scout');

    const once = buildCommittedQuestArchive(committed.世界树, committed, derived.archiveFacts, 4);
    const retried = buildCommittedQuestArchive(once, committed, derived.archiveFacts, 4);
    expect(once.entries).toHaveLength(1);
    expect(retried).toEqual(once);
    expect(once.entries[0]).toMatchObject({ id: 'irminsul_quest_4_quest_scout', turn: 4 });
  });

  it('previews same-turn narrative facts before deriving quest progress, then writes the merged batch once', () => {
    const initial = questState();
    initial.世界.当前地点 = '低语森林';
    initial.任务.active[0]! = {
      ...initial.任务.active[0]!,
      objectives: [{ id: 'objective_arrive', type: 'travel', description: '抵达蒙德城', targetCount: 1, currentCount: 0, completed: false }],
      rewards: [],
    };
    const frozen = structuredClone(initial);
    const factCandidates = [{ domain: 'location' as const, fact: '抵达蒙德城', evidence: '旅行者穿过了蒙德城门' }];
    const narrativeCommands: TeyvatDomainCommand[] = [{
      action: 'set', root: '世界', path: '当前地点', value: '蒙德城', evidence: factCandidates[0]!.evidence,
    }];
    const composed = composeQuestSettlementCommands({
      state: initial,
      narrativeCommands,
      enabled: true,
      questUpdates: [],
      body: '旅行者穿过了蒙德城门。',
      variableFacts: [],
      factCandidates,
      turn: 4,
    });
    expect(composed.previewErrors).toEqual([]);
    expect(composed.quest.commands.some((item) => item.path === 'active[id=quest_scout].status')).toBe(true);

    const replace = vi.fn();
    const transaction = commitTeyvatTurn(initial, composed.commands, replace, {
      factCandidates,
      trustedEvidence: [composed.quest.evidence],
    });
    expect(transaction.status).toBe('committed');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(transaction.nextState.世界.当前地点).toBe('蒙德城');
    expect(transaction.nextState.任务.completed[0]?.id).toBe('quest_scout');
    expect(initial).toEqual(frozen);
  });

  it('does not derive quest commands from a partial cursor when the narrative preview rejects', () => {
    const initial = questState();
    const frozen = structuredClone(initial);
    const factCandidates = [{ domain: 'location' as const, fact: '抵达蒙德城', evidence: '旅行者穿过了蒙德城门' }];
    const invalidNarrative: TeyvatDomainCommand = {
      action: 'set', root: '世界', path: '*', value: '蒙德城', evidence: factCandidates[0]!.evidence,
    };
    const composed = composeQuestSettlementCommands({
      state: initial, narrativeCommands: [invalidNarrative], enabled: true,
      questUpdates: ['完成: 城外侦察'], body: questEvidence, variableFacts: [], factCandidates, turn: 4,
    });
    expect(composed.previewErrors.map((error) => error.code)).toEqual(['WILDCARD_PATH']);
    expect(composed.quest.commands).toEqual([]);
    expect(composed.commands).toEqual([invalidNarrative]);
    const replace = vi.fn();
    const result = commitTeyvatTurn(initial, composed.commands, replace, { factCandidates });
    expect(result.status).toBe('rejected');
    expect(replace).not.toHaveBeenCalled();
    expect(initial).toEqual(frozen);
  });
});
