import { describe, expect, it } from 'vitest';
import { deriveResolvedNpcLedgerFacts, factsToTeyvatDomainCommands, parseVariableFacts, pickSettledCommitments } from '@/utils/variableFacts';
import { buildCourierSenderProfile, appendPhoneExchangeMemory } from '@/services/ai/courierService';
import { buildCourierReplyPrompt, COURIER_SETTLED_TOPIC_RULE } from '@/services/ai/courierLetterModel';
import { buildNpcRelationshipPlanning } from '@/services/npcRelationshipPlanning';
import { createEmptyTeyvatGameState } from '@/models/teyvat/state';
import { normalizeTeyvatNpcRecords } from '@/models/teyvat/character';
import type { NPC记录 } from '@/models/npc';

/**
 * 「已经履行过的约定始终无法结算，角色在手机里反反复复提这件事」（2026-10-18 用户实测）。
 *
 * 旧判定要求「整句与本条约定有 ≥ 70% 的字符重合」，真实正文里几乎不可能满足：约定越长越不可能。
 * 结果约定永远留在账本里，手机每次生成都读到「约定与未完成事项」，角色就一直催。
 */

const 约定 = '答应明天陪旅行者去晨曦酒庄采买材料';

function 记录(overrides: Partial<NPC记录> = {}): NPC记录 {
  return {
    id: 'npc_amber',
    姓名: '安柏',
    阶位: 'companion',
    好感度: 120,
    关系: 'friendly',
    亲密关系: false,
    同行: false,
    初见回合: 3,
    最近回合: 12,
    未完成事项: [约定],
    已完成事项: [],
    共同经历: [],
    必须记得: [],
    禁止遗忘: [],
    未解决冲突: [],
    总结记忆: [],
    备注: [],
    ...overrides,
  } as NPC记录;
}

describe('A 约定结算判定', () => {
  it('真实正文里明确办完的约定会被认定结算（旧实现的字符重合率全部判不出来）', () => {
    const bodies = [
      '安柏把晨曦酒庄的采买办完了。',
      '安柏办完了采买，把材料交给旅行者。',
      '安柏终于完成了晨曦酒庄采买材料的任务。',
      '采买的事已经办完，安柏回到蒙德城。',
    ];
    for (const body of bodies) {
      const facts = deriveResolvedNpcLedgerFacts(body, [记录()]);
      expect(facts, body).toContainEqual(expect.objectContaining({ name: '安柏', resolvedItems: [约定] }));
    }
  });

  it('否定、提问、以及别的角色的完成都不会误结算', () => {
    expect(deriveResolvedNpcLedgerFacts('安柏还没办完采买。', [记录()])).toHaveLength(0);
    expect(deriveResolvedNpcLedgerFacts('安柏办完采买了吗？', [记录()])).toHaveLength(0);
    // 同名 NPC 才结算：正文说的是凯亚，安柏的约定不动
    expect(deriveResolvedNpcLedgerFacts('凯亚办完了酒庄采购。', [记录()])).toHaveLength(0);
    // 只共享通用词元的别的约定不结算
    expect(pickSettledCommitments(['明日一起巡逻'], '安柏办完了晨曦酒庄的采买。')).toEqual([]);
  });

  it.each([
    '安柏完成晨曦酒庄的采买了？',
    '安柏打算明天完成晨曦酒庄的采买。',
    '安柏准备办完晨曦酒庄的采买。',
    '如果安柏办完晨曦酒庄的采买，就回城。',
    '安柏完成晨曦酒庄的采买以后再回城。',
    '如果明天天气好，安柏就完成晨曦酒庄的采买。',
    '安柏计划今晚出发，完成晨曦酒庄的采买再回城。',
    '安柏明天完成晨曦酒庄的采买。',
    '到明天这个时候，安柏就已经完成晨曦酒庄的采买了。',
    '明天中午，安柏已经完成晨曦酒庄的采买了。',
    '安柏明天就已经完成晨曦酒庄的采买了。',
    '安柏完成晨曦酒庄采买的计划还在准备中。',
  ])('疑问或未发生的履约不能清掉账本：%s', (body) => {
    expect(deriveResolvedNpcLedgerFacts(body, [记录()])).toEqual([]);
    expect(pickSettledCommitments([约定], body)).toEqual([]);
  });

  it.each([
    '安柏完成了明天要用的晨曦酒庄材料采买。',
    '安柏已经把明天要用的晨曦酒庄材料买好了。',
    '安柏原计划明天采买，但今天已经完成了晨曦酒庄的采买。',
  ])('未来用途或旧计划不能抹掉明确已完成的履约：%s', (body) => {
    expect(deriveResolvedNpcLedgerFacts(body, [记录()])).toContainEqual(expect.objectContaining({ name: '安柏', resolvedItems: [约定] }));
  });

  it('模型自报的 resolvedItems 只写短语也能命中旧条目（它看不到账本原文）', () => {
    const parsed = parseVariableFacts(`<变量事实>${JSON.stringify({
      facts: [{ type: 'npc', name: '安柏', resolvedItems: ['采买材料'], evidence: '安柏把材料买齐了。' }],
    })}</变量事实>`);
    const state = createEmptyTeyvatGameState();
    state.NPC = normalizeTeyvatNpcRecords([{ id: 'npc_amber', 姓名: '安柏', relationshipLedger: { unfinishedBusiness: [约定] } }]);
    const result = factsToTeyvatDomainCommands(parsed.facts, state, 12);
    expect(result.commands).toContainEqual(expect.objectContaining({
      action: 'set', root: 'NPC', path: '[id=npc_amber].relationshipLedger.unfinishedBusiness', value: [],
    }));
    expect(result.commands).toContainEqual(expect.objectContaining({
      action: 'set', root: 'NPC', path: '[id=npc_amber].relationshipLedger.completedBusiness', value: [约定],
    }));
  });

  it('结算后留下「已完成」正面记录，旧存档没有该字段也不报错', () => {
    const parsed = parseVariableFacts(`<变量事实>${JSON.stringify({
      facts: [{ type: 'npc', name: '安柏', resolvedItems: [约定], evidence: '安柏把材料买齐了。' }],
    })}</变量事实>`);
    const state = createEmptyTeyvatGameState();
    state.NPC = normalizeTeyvatNpcRecords([{
      id: 'npc_amber', 姓名: '安柏',
      relationshipLedger: { unfinishedBusiness: [约定], completedBusiness: ['一起看过风起地的风'] },
    }]);
    const result = factsToTeyvatDomainCommands(parsed.facts, state, 12);
    expect(result.commands).toContainEqual(expect.objectContaining({
      action: 'set', root: 'NPC', path: '[id=npc_amber].relationshipLedger.completedBusiness',
      value: ['一起看过风起地的风', 约定],
    }));
  });
});

describe('B 手机：结算 + 不再复述', () => {
  it('玩家在手机上说明已经办完，未完成约定立刻结算并进入已完成记录', () => {
    const npcs = appendPhoneExchangeMemory([记录()], {
      npcId: 'npc_amber',
      conversationId: 'c1',
      exchangeId: 'm1',
      turn: 13,
      playerText: '酒庄的材料我早买好了，你不用再问啦',
      replyTexts: ['那就好，我还怕你忘了呢。'],
    });
    expect(npcs[0]!.未完成事项).toEqual([]);
    expect(npcs[0]!.已完成事项).toContain(约定);
  });

  it('玩家只是提问时不结算', () => {
    const npcs = appendPhoneExchangeMemory([记录()], {
      npcId: 'npc_amber',
      conversationId: 'c1',
      exchangeId: 'm2',
      turn: 13,
      playerText: '采买的事办完了吗？',
      replyTexts: ['还没呢，明天去。'],
    });
    expect(npcs[0]!.未完成事项).toEqual([约定]);
  });

  it('已完成约定单独成栏，手机自己的历史消息不再当成同行记忆回灌', () => {
    const profile = buildCourierSenderProfile(记录({
      已完成事项: [约定],
      同行记忆: [
        { id: 'a', 回合: 10, 摘要: '答应明天去采买材料', 来源: '变量' },
        { id: 'b', 回合: 11, 摘要: '安柏在手机上问什么时候去买材料', 来源: '手机' },
      ],
    }), { messages: [] }, '安柏');
    expect(profile.unfinishedBusiness).toEqual([约定]);
    expect(profile.completedBusiness).toEqual([约定]);
    expect(profile.recentMemories).toContain('答应明天去采买材料');
    // 手机往来本身已在「近期手机对话」里；再进「近期同行记忆」会让角色把自己的上一句复述成新话题
    expect(profile.recentMemories?.join()).not.toContain('什么时候去买材料');

    const prompt = buildCourierReplyPrompt({
      conversation: { title: '安柏' } as never,
      playerMessage: { content: '今天风很大' } as never,
      sender: profile,
      travelerName: '旅行者',
    } as never);
    expect(prompt).toContain('已经完成的约定（不要再催、不要再当待办）：');
    expect(prompt).toContain(COURIER_SETTLED_TOPIC_RULE);
  });
});

describe('C 关系规划：未完成承诺 / 已完成承诺', () => {
  it('两栏分开列出，已完成的约定不再被当成「该兑现的承诺」', () => {
    const 已办完 = buildNpcRelationshipPlanning([记录({ 未完成事项: [], 已完成事项: [约定] })], 13).条目[0]!;
    expect(已办完.未完成承诺).toEqual([]);
    expect(已办完.已完成承诺).toEqual([约定]);
    expect(已办完.建议动作).not.toBe('兑现承诺或冲突');
    expect(已办完.关注点.join()).toContain('已经办完');

    const 未办完 = buildNpcRelationshipPlanning([记录({
      同行记忆: [{ id: 'm', 回合: 12, 摘要: '和旅行者约好去晨曦酒庄采买材料', 来源: '变量' }],
    })], 13).条目[0]!;
    expect(未办完.未完成承诺).toEqual([约定]);
    expect(未办完.建议动作).toBe('兑现承诺或冲突');
  });
});
