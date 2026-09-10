import { describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState, type TeyvatGameState, type TeyvatSaveData } from '../../models/teyvat';
import { buildSavePayload } from '../../hooks/useGame/saveLoadWorkflow';

describe('buildSavePayload explicit base game', () => {
  it('builds recovery autosave from the exact committed/background root instead of a stale React closure', () => {
    const stale = createEmptyTeyvatGameState();
    stale.turnCount = 1;
    stale.世界.当前地点 = '旧地点';
    stale.旅行者.姓名 = '旧旅行者';

    const committed = createEmptyTeyvatGameState();
    committed.turnCount = 8;
    committed.世界.当前地点 = '璃月港';
    committed.旅行者.姓名 = '荧';
    committed.背包.items.push({ id: 'item_exact', category: 'material', name: '石珀', description: '', quantity: 4, rarity: 3, obtainedAtTurn: 8, stackable: true });
    committed.NPC.push({
      id: 'npc_exact', 姓名: '刻晴', 地区: '璃月', 身份: '玉衡星', 天赋: [], 说明: '', aliases: [], roleTier: 'companion', affinity: 7,
      relationship: '', intimate: false, travelingTogether: false, firstSeenTurn: 8, lastSeenTurn: 8, gender: '女', playerAddress: '', appearance: '', clothing: '', speechStyle: '', personality: '', equipmentSummary: '', sharedMemories: [], relationshipLedger: { recentInteraction: '', longTermImpression: '', currentStage: '', sharedExperiences: [], unfinishedBusiness: [], unresolvedConflicts: [], mustRemember: [], protectedFacts: [], summaries: [] }, notes: [], playerCorrections: [], canonical: true, avatar: '', visualArchive: { slotImages: {} }, matureArchive: null,
    });
    committed.任务.active.push({ id: 'quest_exact', title: '璃月事务', description: '', source: 'side', status: 'active', objectives: [], rewards: [], createdAtTurn: 8, updatedAt: 8 });
    committed.对话.entries.push({ id: 'assistant-exact', role: 'assistant', content: '已抵达璃月港。', timestamp: 8, gameTime: '7' });

    const state: { game: TeyvatGameState; chatHistory: never[]; variableBatches: never[] } = {
      game: stale,
      chatHistory: [],
      variableBatches: [],
    };
    const buildWithBase = buildSavePayload as unknown as (
      state: { game: TeyvatGameState; chatHistory: never[]; variableBatches: never[] },
      type: 'auto',
      overrides: undefined,
      baseGame: TeyvatGameState,
    ) => TeyvatSaveData;
    const payload = buildWithBase(state, 'auto', undefined, committed);

    expect(payload.turnCount).toBe(8);
    expect(payload.世界.当前地点).toBe('璃月港');
    expect(payload.旅行者.姓名).toBe('荧');
    expect(payload.背包.items).toEqual([expect.objectContaining({ id: 'item_exact', quantity: 4 })]);
    expect(payload.NPC).toEqual([expect.objectContaining({ id: 'npc_exact', affinity: 7 })]);
    expect(payload.任务.active).toEqual([expect.objectContaining({ id: 'quest_exact' })]);
    expect(payload.对话.entries).toEqual([expect.objectContaining({ id: 'assistant-exact', content: '已抵达璃月港。' })]);
  });
});
