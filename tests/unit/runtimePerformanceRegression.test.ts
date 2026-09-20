import { describe, expect, it } from 'vitest';
import { applyChatHistoryAction, createLegacyGameViewSelector } from '@/hooks/useGameState';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import { preflightTeyvatTurn } from '@/services/teyvatTurnTransaction';
import type { NPC记录 } from '@/models/npc';
import { buildNpcRelationshipPlanning } from '@/services/npcRelationshipPlanning';
import { enrichNpcArchives } from '@/utils/npcArchiveEnrichment';
import { estimateTurnPlaceholderHeight } from '@/components/features/Chat/TurnItem';

describe('runtime performance regressions', () => {
  it('estimates deferred turn placeholders from the measured turn-height model', () => {
    // 实测口径：headless Chrome + dist 编译后 CSS 渲染真实回合 DOM 结构，
    // 400/700/1000/1600/2400 字的回合真实高度 = 657/897/1214/1848/2593 px，
    // 拟合 height ≈ 240 + 0.99 × 字数（.triage/measure-turn-height.mjs）。
    // 旧的固定 640px 在 1000 字回合上低估 574px，2400 字上低估 1953px。
    expect(estimateTurnPlaceholderHeight(1000)).toBeGreaterThan(1100);
    expect(estimateTurnPlaceholderHeight(1000)).toBeLessThan(1330);
    expect(estimateTurnPlaceholderHeight(2400)).toBeGreaterThan(2400);
    // 单调不减 + 下限兜底（空正文回合仍有工具栏/选项区；实测截距 AI=240px、玩家=97px）。
    expect(estimateTurnPlaceholderHeight(1600)).toBeGreaterThan(estimateTurnPlaceholderHeight(700));
    expect(estimateTurnPlaceholderHeight(0, 'assistant')).toBeGreaterThan(200);
    expect(estimateTurnPlaceholderHeight(0, 'assistant')).toBeLessThan(320);
    // 玩家回合比 AI 回合矮得多（实测 600 字 = 389px vs 640px 固定占位）——同一个常数不可能同时贴合两者。
    expect(estimateTurnPlaceholderHeight(600, 'user')).toBeLessThan(estimateTurnPlaceholderHeight(600, 'assistant'));
  });

  it('keeps legacy slice references stable when only the phone changes', () => {
    const select = createLegacyGameViewSelector();
    const initial = createEmptyTeyvatGameState();
    const first = select(initial);
    const second = select({
      ...initial,
      手机: { ...initial.手机, unreadTotal: 1 },
    });

    expect(second).toBe(first);

    const npcChanged = select({
      ...initial,
      NPC: [...initial.NPC],
    });
    expect(npcChanged).not.toBe(first);
    expect(npcChanged.NPC).not.toBe(first.NPC);
    expect(npcChanged.chatHistory).toBe(first.chatHistory);
    expect(npcChanged.相册).toBe(first.相册);
    expect(npcChanged.variableBatches).toBe(first.variableBatches);

    // setChatHistory 的身份快速通道：updater 原样返回同一个数组时，
    // 不得重建整个 game（旧的 toLegacyChat → withLegacyChat 会整条重跑）。
    const chatState = createEmptyTeyvatGameState();
    expect(applyChatHistoryAction(chatState, (history) => history)).toBe(chatState);
    // 数组真的变了就必须照旧重建（快速通道不得吞掉有效更新）。
    const appended = applyChatHistoryAction(chatState, (history) => [
      ...history,
      { id: 'm-append', role: 'user', content: '往码头走', timestamp: 1 } as never,
    ]);
    expect(appended).not.toBe(chatState);
    expect(appended.对话.entries).toHaveLength(1);
  });

  it('preflights commands without normalizing the entire game root', () => {
    const initial = createEmptyTeyvatGameState();
    initial.turnCount = 1.75;
    const result = preflightTeyvatTurn(initial, [{
      action: 'set',
      root: '世界',
      path: '当前地点',
      value: '蒙德城',
      evidence: '城门在晨光中打开',
    }], {
      factCandidates: [{ domain: 'location', fact: '旅行者抵达蒙德城', evidence: '城门在晨光中打开' }],
    });

    expect(result.status).toBe('accepted');
    expect(result.nextState.turnCount).toBe(1.75);
    expect(result.nextState.世界.当前地点).toBe('蒙德城');
  });

  it('reuses enriched archives for unchanged NPC objects when one companion changes', () => {
    const npc = (id: string, name: string): NPC记录 => ({
      id,
      姓名: name,
      阶位: 'extra',
      好感度: 0,
      关系: 'stranger',
      同行: false,
      初见回合: 1,
      最近回合: 1,
      备注: [],
    });
    const lisa = npc('npc-lisa', '丽莎');
    const amber = npc('npc-amber', '安柏');
    const options = { nsfwEnabled: false, maleNsfwArchiveEnabled: false };

    const first = enrichNpcArchives([lisa, amber], options);
    const second = enrichNpcArchives([lisa, { ...amber, 好感度: 5 }], options);

    expect(second.records[0]).toBe(first.records[0]);
    expect(second.records[1]).not.toBe(first.records[1]);
    expect(second.records[1]?.好感度).toBe(5);
  });

  it('reads each NPC memory ledger only once while building relationship planning', () => {
    let memoryReads = 0;
    const npc: NPC记录 = {
      id: 'npc-lisa',
      姓名: '丽莎',
      阶位: 'extra',
      好感度: 0,
      关系: 'stranger',
      同行: false,
      初见回合: 1,
      最近回合: 8,
      备注: [],
    };
    Object.defineProperty(npc, '同行记忆', {
      configurable: true,
      enumerable: true,
      get: () => {
        memoryReads += 1;
        return ['与旅行者约定在图书馆再见'];
      },
    });

    const planning = buildNpcRelationshipPlanning([npc], 10);

    expect(planning.条目).toHaveLength(1);
    expect(planning.条目[0]?.建议动作).toBe('兑现承诺或冲突');
    expect(memoryReads).toBe(1);
  });
});
