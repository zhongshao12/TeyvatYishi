import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState, type TeyvatSaveData } from '../../models/teyvat';
import { 创建默认游戏设置 } from '../../models/settings';
import type { UseGameStateReturn } from '../../hooks/useGameState';
import { parseWorkflowRecoveryJournal } from '../../utils/workflowRecoveryModel';

const spies = vi.hoisted(() => ({
  saveGame: vi.fn(async (_save: TeyvatSaveData) => 1),
  persist: vi.fn(async () => undefined),
}));

vi.mock('../../services/dbService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/dbService')>()),
  saveGame: spies.saveGame,
}));

vi.mock('../../services/workflowRecovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/workflowRecovery')>()),
  persistWorkflowRecoveryJournal: spies.persist,
}));

import { resumeCommittedSettlementWorkflow } from '../../hooks/useGame/sendWorkflow';

describe('committed restart post-settlement tail', () => {
  beforeEach(() => {
    spies.saveGame.mockClear();
    spies.persist.mockClear();
  });

  it('ignores the stale React root and autosaves every committed domain slice and formal history', async () => {
    const stale = createEmptyTeyvatGameState();
    stale.turnCount = 2;
    stale.世界.当前地点 = '旧地点';
    stale.旅行者.姓名 = '旧旅行者';

    const committed = createEmptyTeyvatGameState();
    committed.turnCount = 11;
    committed.世界.当前地点 = '稻妻城';
    committed.世界.当前日期 = '提瓦特历 11 日';
    committed.旅行者.姓名 = '荧';
    committed.背包.items.push({ id: 'item_committed', category: 'material', name: '绯樱绣球', description: '', quantity: 6, rarity: 3, obtainedAtTurn: 11, stackable: true });
    committed.NPC.push({
      id: 'npc_committed', 姓名: '神里绫华', 地区: '稻妻', 身份: '白鹭公主', 天赋: [], 说明: '', aliases: [], roleTier: 'companion', affinity: 9,
      relationship: '', intimate: false, travelingTogether: false, firstSeenTurn: 11, lastSeenTurn: 11, gender: '女', playerAddress: '', appearance: '', clothing: '', speechStyle: '', personality: '', equipmentSummary: '', sharedMemories: [], relationshipLedger: { recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [], unfinishedBusiness: [], unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [] }, notes: [], playerCorrections: [], canonical: true, avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
    });
    committed.任务.active.push({ id: 'quest_committed', title: '稻妻见闻', description: '', source: 'side', status: 'active', objectives: [], rewards: [], createdAtTurn: 11, updatedAt: 11 });
    committed.对话.entries.push(
      { id: 'user-11', role: 'user', content: '前往稻妻城', timestamp: 10, gameTime: '10' },
      {
        id: 'assistant-11', role: 'assistant', content: '稻妻城的灯火亮起。', timestamp: 11, gameTime: '10',
        structuredResponse: {
          body: [{ kind: 'narration', text: '稻妻城的灯火亮起。' }], choices: [], factCandidates: [],
          continuation: { summary: '抵达稻妻城', unresolved: [] },
        },
      },
    );
    const journal = parseWorkflowRecoveryJournal({
      version: 3, workflowId: 'restart-11', startedAt: 11, updatedAt: 11, input: '前往稻妻城', turnAtStart: 10,
      phase: 'settlement_committed', phaseStartedAt: 11, assistantMessageId: 'assistant-11', committedState: committed,
    })!;
    const settings = 创建默认游戏设置();
    settings.蒸汽鸟报系统.enabled = false;
    settings.手机系统.enabled = false;
    settings.文生图系统.正文生图.enabled = false;
    const replaced: unknown[] = [];
    // 复刻 UseGameStateReturn 的真实语义：`game` 是渲染快照，活体存档只有 setState 能看到。
    // 恢复尾流程现在按「提交那一刻的活体存档」复核存档身份（CAS），所以假状态必须提供
    // updateGameState 的 updater 语义；断言语义不变：提交后活体根恰好被替换一次。
    const live = { current: stale as unknown };
    const state = {
      game: stale,
      chatHistory: [],
      variableBatches: [],
      NPC: [],
      旅人: {} as UseGameStateReturn['旅人'],
      相册: {} as UseGameStateReturn['相册'],
      gameSettings: settings,
      apiSettings: { activeConfigId: '', configs: [] },
      replaceGameState: (next: unknown) => {
        live.current = next;
        replaced.push(next);
      },
      updateGameState: (updater: (current: unknown) => unknown) => {
        const next = updater(live.current);
        if (next === live.current) return;
        live.current = next;
        replaced.push(next);
      },
      setHasSave: vi.fn(),
    } as unknown as UseGameStateReturn;

    const result = await resumeCommittedSettlementWorkflow(state, journal);
    expect(result).toMatchObject({ ok: true, journal: { phase: 'autosave_committed' } });
    expect(replaced).toHaveLength(1);
    expect(spies.saveGame).toHaveBeenCalledTimes(1);
    const saved = spies.saveGame.mock.calls[0]?.[0];
    expect(saved).toBeDefined();
    if (!saved) return;
    expect(saved.turnCount).toBe(11);
    expect(saved.世界.当前地点).toBe('稻妻城');
    expect(saved.旅行者.姓名).toBe('荧');
    expect(saved.背包.items).toEqual([expect.objectContaining({ id: 'item_committed', quantity: 6 })]);
    expect(saved.NPC).toEqual([expect.objectContaining({ id: 'npc_committed', affinity: 9 })]);
    expect(saved.任务.active).toEqual([expect.objectContaining({ id: 'quest_committed' })]);
    expect(saved.对话.entries.map((entry) => entry.id)).toEqual(['user-11', 'assistant-11']);
    expect(spies.persist).toHaveBeenCalledWith(expect.objectContaining({ phase: 'autosave_committed', committedState: expect.any(Object) }));
  });
});
