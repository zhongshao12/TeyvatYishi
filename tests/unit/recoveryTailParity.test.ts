import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState, type TeyvatGameState } from '@/models/teyvat';
import { 创建默认游戏设置 } from '@/models/settings';
import { toLegacyTurnCheckpoint, type UseGameStateReturn } from '@/hooks/useGameState';
import { captureWorldMoment } from '@/services/worldMoment';
import { confirmSteambirdFact } from '@/services/steambirdPublicFacts';
import { parseWorkflowRecoveryJournal } from '@/utils/workflowRecoveryModel';
import { unlockElement } from '@/services/elementalAttunementService';
import { 创建NPC记录 } from '@/models/npc';
import { applyLegacyGameStateOverrides } from '@/hooks/useGameState';
import { normalizeCourierSystem } from '@/models/teyvat/courier';

vi.mock('@/services/dbService', async original => ({ ...(await original<typeof import('@/services/dbService')>()), saveGame: vi.fn(async () => 1) }));
import { runPostSettlementRecoveryWorkflow } from '@/hooks/useGame/postSettlementRecoveryWorkflow';

let sequence = 100;
function setup(body: string) {
  let live = createEmptyTeyvatGameState();
  const session = ++sequence, id = `recover-parity-${session}`;
  live.turnCount = 5;
  live.世界.当前日期 = '1000.03.11'; live.世界.当前时间 = '14:00'; live.世界.当前地点 = '蒙德';
  live.叙事.lastCommittedMoment = captureWorldMoment(live.世界, 5, id);
  live.旅行者 = unlockElement(live.旅行者, 'anemo', { source: 'traveler_resonance', unlockedAt: '1日' });
  live.对话.entries = [{ id: 'u', role: 'user', content: '私人聊天不能上报', timestamp: 1 }, { id: 'a', role: 'assistant', content: body, timestamp: 2 }];
  const settings = 创建默认游戏设置(); settings.手机系统.enabled = false; settings.蒸汽鸟报系统.enabled = true;
  settings.蒸汽鸟报系统.autoGenerate = true; settings.文生图系统.正文生图.enabled = false;
  const config = { id: 'news', name: 'news', provider: 'openai_compatible' as const, baseUrl: 'https://news.invalid/v1', apiKey: '', model: 'news', createdAt: 0, updatedAt: 0 };
  const state = { game: live, ...toLegacyTurnCheckpoint({ traveler: live.旅行者, npc: live.NPC, album: live.相册, turnCount: 5, pendingOpeningTrigger: null }),
    gameSettings: settings, apiSettings: { configs: [config], activeConfigId: 'news' }, getGameSessionId: () => session,
    updateGameState: (fn: (root: TeyvatGameState) => TeyvatGameState) => { live = fn(live); }, setHasSave: vi.fn(), setQueueTasks: vi.fn(),
  } as unknown as UseGameStateReturn;
  const journal = () => parseWorkflowRecoveryJournal({ version: 3, workflowId: id, startedAt: 1, updatedAt: 1, turnAtStart: 4, input: '私人聊天不能上报', phase: 'settlement_committed', phaseStartedAt: 1, assistantMessageId: 'a', committedState: live })!;
  return { state, live: () => live, journal, edit: (fn: (root: TeyvatGameState) => void) => fn(live),
    update: (fn: (root: TeyvatGameState) => TeyvatGameState) => { live = fn(live); } };
}
afterEach(() => vi.unstubAllGlobals());

it('recovery never publishes private narrative as a local public article', async () => {
  const h = setup('旅行者私下向丽莎说明自己的秘密。');
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await runPostSettlementRecoveryWorkflow(h.state, h.journal());
  expect(h.live().蒸汽鸟报.articles).toEqual([]); expect(fetcher).not.toHaveBeenCalled();
});

it('recovery uses the independent model for confirmed facts and preserves evidence metadata', async () => {
  const h = setup('旅行者私下向丽莎说明自己的秘密。');
  const text = '公开公告：风花节展览已经开放。';
  const fact = confirmSteambirdFact({ domain: 'world', fact: text, evidence: text }, { history: [{ kind: 'narration', text }], moment: h.live().叙事.lastCommittedMoment!, playerConfirmed: false })!;
  h.edit(root => { root.蒸汽鸟报.confirmedFacts = [fact]; });
  const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ publicArticles: [{ title: '展览开放', lead: '展览已开放。', body: '市民可参观展览。', sourceFactIds: [fact.id] }] }) } }] })));
  vi.stubGlobal('fetch', fetcher);
  await runPostSettlementRecoveryWorkflow(h.state, h.journal());
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0]?.[1]?.body)).not.toContain('私人聊天不能上报');
  expect(h.live().蒸汽鸟报.confirmedFacts).toEqual([fact]);
  expect(h.live().蒸汽鸟报.articles[0]).toMatchObject({ title: '展览开放', sourceFactIds: [fact.id], worldMoment: fact.worldMoment });
  await runPostSettlementRecoveryWorkflow(h.state, h.journal());
  expect(fetcher).toHaveBeenCalledTimes(1); expect(h.live().蒸汽鸟报.articles).toHaveLength(1);
});

it('recovery grants missing elemental mastery once, including repeated restart', async () => {
  const h = setup('旅行者施放风元素攻击。'); h.state.gameSettings.蒸汽鸟报系统.enabled = false;
  await runPostSettlementRecoveryWorkflow(h.state, h.journal());
  expect(h.live().旅行者.元素共鸣[0]?.mastery).toBe(2);
  await runPostSettlementRecoveryWorkflow(h.state, h.journal());
  expect(h.live().旅行者.元素共鸣[0]?.mastery).toBe(2);
});
it('keeps concurrent profile, memory, phone and public facts while applying mastery exactly once', async () => {
  const h = setup('旅行者施放风元素攻击。');
  const npc = 创建NPC记录({ 姓名: '安柏', 初见回合: 1, 阶位: 'companion', 原著角色: true });
  h.update(root => applyLegacyGameStateOverrides(root, { NPC: [npc] }));
  const publicFact = (text: string) => confirmSteambirdFact({ domain: 'world', fact: text, evidence: text },
    { history: [{ kind: 'narration', text }], moment: h.live().叙事.lastCommittedMoment!, playerConfirmed: false })!;
  const first = publicFact('公开公告：风花节展览已经开放。'), second = publicFact('公开公告：骑士团招募已经开始。');
  h.edit(root => { root.蒸汽鸟报.confirmedFacts = [first]; });
  vi.stubGlobal('fetch', async () => {
    h.update(root => ({ ...root, 旅行者: { ...root.旅行者, 姓名: '新姓名', 外貌: '玩家编辑外貌' },
      NPC: root.NPC.map(record => ({ ...record, appearance: '玩家编辑档案' })),
      记忆: { ...root.记忆, immediate: [...root.记忆.immediate, '玩家新手记'] },
      手机: { ...root.手机, letters: [...root.手机.letters, { id: 'late-letter', senderId: npc.id, senderName: '安柏', content: '新短信', turn: 5, timestamp: 3, status: 'delivered' }] },
      蒸汽鸟报: { ...root.蒸汽鸟报, confirmedFacts: [first, second] },
    }));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ publicArticles: [{ title: '展览开放', lead: '展览已开放。', body: '市民可参观展览。', sourceFactIds: [first.id] }] }) } }] }));
  });
  await runPostSettlementRecoveryWorkflow(h.state, h.journal());
  expect(h.live().旅行者).toMatchObject({ 姓名: '新姓名', 外貌: '玩家编辑外貌' });
  expect(h.live().旅行者.元素共鸣[0]?.mastery).toBe(2);
  expect(h.live().NPC[0]?.appearance).toBe('玩家编辑档案');
  expect(h.live().记忆.immediate).toContain('玩家新手记');
  expect(h.live().记忆.immediate.some(text => text.includes('施放风元素'))).toBe(true);
  expect(h.live().手机.letters.some(letter => letter.id === 'late-letter')).toBe(true);
  expect(h.live().蒸汽鸟报.confirmedFacts?.map(fact => fact.id)).toEqual([first.id, second.id]);
  await runPostSettlementRecoveryWorkflow(h.state, h.journal());
  expect(h.live().旅行者.元素共鸣[0]?.mastery).toBe(2);
});

it('recovery compresses the committed memory and NPC ledger through normal domain stages', async () => {
  const h = setup('安柏完成了最后一次侦察。'); h.state.gameSettings.蒸汽鸟报系统.enabled = false;
  const npc = 创建NPC记录({ 姓名: '安柏', 阶位: 'companion', 原著角色: true, 初见回合: 1 });
  npc.同行记忆 = Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, 回合: i + 1, 摘要: `共同完成第${i}次侦察任务。`, 来源: '正文' as const }));
  h.edit(root => Object.assign(root, applyLegacyGameStateOverrides(root, { NPC: [npc], 记忆: { 即时记忆: ['早期旅行记忆'], 短期记忆: [], 中期记忆: [], 长期记忆: [] } })));
  h.state.gameSettings.记忆系统.启用中短长期API总结 = false;
  h.state.gameSettings.记忆系统.即时转短期阈值 = 2;
  h.state.gameSettings.记忆系统.NPC记忆压缩阈值 = 3;
  await runPostSettlementRecoveryWorkflow(h.state, h.journal());
  expect(h.live().记忆.shortTerm.length).toBeGreaterThan(0);
  expect(h.live().NPC[0]?.relationshipLedger.summaries.length).toBeGreaterThan(0);
  const serialized = JSON.stringify(h.live().记忆);
  await runPostSettlementRecoveryWorkflow(h.state, h.journal());
  expect(JSON.stringify(h.live().记忆)).toBe(serialized);
});

it('recovery answers pending private messages rather than declaring autosave complete without replies', async () => {
  const h = setup('旅行者与安柏休息。'); h.state.gameSettings.蒸汽鸟报系统.enabled = false;
  h.state.gameSettings.手机系统.enabled = true; h.state.gameSettings.手机系统.autoGenerateSeeds = false;
  h.state.apiSettings.configs = [];
  const npc = { ...创建NPC记录({ 姓名: '安柏', 阶位: 'companion', 原著角色: true, 初见回合: 1 }), id: 'amber' };
  h.edit(root => {
    Object.assign(root, applyLegacyGameStateOverrides(root, { NPC: [npc] }));
    root.手机 = normalizeCourierSystem({ contacts: [{ id: 'contact-amber', npcId: 'amber', name: '安柏' }], conversations: [{ id: 'private-amber', type: 'private', title: '安柏', participantIds: ['contact-amber'], messages: [{ id: 'player-phone', senderId: 'player', senderName: '旅行者', content: '休息好了？', role: 'player', turn: 5, timestamp: 1 }] }] });
  });
  await runPostSettlementRecoveryWorkflow(h.state, h.journal());
  expect(h.live().手机.conversations[0]?.messages.at(-1)?.senderId).not.toBe('player');
  expect(h.live().NPC[0]?.sharedMemories.length).toBeGreaterThan(0);
});

it.each(['edit', 'delete'] as const)('merges recovered phone affinity with concurrent %s without duplicating a reply or resurrecting an NPC', async mode => {
  const h = setup('旅行者与安柏休息。');
  h.state.gameSettings.手机系统.enabled = true;
  h.state.gameSettings.手机系统.autoGenerateSeeds = false;
  h.state.apiSettings.configs = [];
  h.state.gameSettings.蒸汽鸟报系统.api = { provider: 'openai_compatible', baseUrl: 'https://news.invalid/v1', apiKey: '', model: 'news', retryCount: 0 };
  const npc = { ...创建NPC记录({ 姓名: '安柏', 阶位: 'companion', 原著角色: true, 初见回合: 1 }), id: 'amber', 好感度: 10 };
  const text = '公开公告：风花节展览已经开放。';
  const fact = confirmSteambirdFact({ domain: 'world', fact: text, evidence: text },
    { history: [{ kind: 'narration', text }], moment: h.live().叙事.lastCommittedMoment!, playerConfirmed: false })!;
  h.edit(root => {
    Object.assign(root, applyLegacyGameStateOverrides(root, { NPC: [npc] }));
    root.蒸汽鸟报.confirmedFacts = [fact];
    root.手机 = normalizeCourierSystem({ contacts: [{ id: 'contact-amber', npcId: 'amber', name: '安柏' }],
      conversations: [{ id: 'private-amber', type: 'private', title: '安柏', participantIds: ['contact-amber'],
        messages: [{ id: 'player-phone', senderId: 'player', senderName: '旅行者', content: '谢谢你', role: 'player', turn: 5, timestamp: 1 }] }] });
  });
  const fetcher = vi.fn(async () => {
    h.update(root => ({ ...root, NPC: mode === 'delete' ? [] : root.NPC.map(record => ({ ...record, affinity: 15, appearance: '等待期间编辑' })) }));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ publicArticles: [
      { title: '展览开放', lead: '展览已开放。', body: '市民可参观展览。', sourceFactIds: [fact.id] },
    ] }) } }] }));
  });
  vi.stubGlobal('fetch', fetcher);
  const originalJournal = h.journal();
  await runPostSettlementRecoveryWorkflow(h.state, originalJournal);
  if (mode === 'delete') expect(h.live().NPC).toEqual([]);
  else {
    expect(h.live().NPC[0]?.affinity).toBe(17);
    expect(h.live().NPC[0]?.appearance).toBe('等待期间编辑');
    expect(h.live().NPC[0]?.sharedMemories.filter(memory => memory.source === 'courier')).toHaveLength(1);
  }
  await runPostSettlementRecoveryWorkflow(h.state, originalJournal);
  if (mode === 'delete') expect(h.live().NPC).toEqual([]);
  else expect(h.live().NPC[0]?.affinity).toBe(17);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
