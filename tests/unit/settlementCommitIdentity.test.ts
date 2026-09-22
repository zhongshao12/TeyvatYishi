import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState, type TeyvatGameState } from '../../models/teyvat';
import { 创建默认游戏设置 } from '../../models/settings';
import { 创建空记忆系统 } from '../../models/memory';
import type { UseGameStateReturn } from '../../hooks/useGameState';
import type { 队列任务记录 } from '../../models/queueTask';
import {
  capturePostSettlementSaveToken,
  isSamePostSettlementSave,
} from '../../hooks/useGame/postSettlementRecoveryWorkflow';

/**
 * 本轮回归的行为契约：变量结算提交必须落到**活体根**上。
 *
 * 用户报告的症状（一次提交被误判成「等待期间换了存档」后整体丢弃）：
 *  - 聊天里每条消息的「第 N 回合」不再增长；
 *  - 自动存档的回合数卡住（`state.turnCount + 1` 恒定）；
 *  - 手机里所有新消息都落在同一回合，回合分割线全部消失。
 *
 * 根因：CAS 基准取自 `state.game` —— 那是**本次发送开始那次渲染**的快照，
 * 连本回合的 user 消息都还没有（`prepareSendTurn` 之后才写入），
 * 于是它与提交那一刻的活体根**必然**不等（对话少一条），每一次结算都被拒绝。
 */

const spies = vi.hoisted(() => ({
  runVariableSettlementWorkflow: vi.fn(),
}));

vi.mock('../../hooks/useGame/variableSettlementWorkflow', () => ({
  runVariableSettlementWorkflow: spies.runVariableSettlementWorkflow,
}));

import { runVariableCalibrationStep } from '../../hooks/useGame/sendWorkflow';

function buildRoot(input: { turnCount: number; conversationId: string; location: string; playerId: string }): TeyvatGameState {
  const root = createEmptyTeyvatGameState();
  root.turnCount = input.turnCount;
  root.世界.当前地点 = input.location;
  root.旅行者.姓名 = input.playerId;
  root.对话.entries.push(
    { id: `${input.conversationId}-user`, role: 'user', content: '出发', timestamp: 1, gameTime: `${input.turnCount}` },
    { id: `${input.conversationId}-assistant`, role: 'assistant', content: '风起了。', timestamp: 2, gameTime: `${input.turnCount}` },
  );
  return normalizeTeyvatGameState(root);
}

/** 复刻 `UseGameStateReturn` 的真实语义：`game` 是渲染快照，`updateGameState` 拿到活体根。 */
function buildStateHarness(staleSnapshot: TeyvatGameState, initialLive: TeyvatGameState) {
  const live = { current: initialLive };
  const writes: TeyvatGameState[] = [];
  let queueTasks: 队列任务记录[] = [];
  const state = {
    game: staleSnapshot,
    turnCount: staleSnapshot.turnCount,
    chatHistory: [...staleSnapshot.对话.entries],
    variableBatches: [],
    NPC: [],
    gameSettings: 创建默认游戏设置(),
    queueTasks,
    setQueueTasks: (action: React.SetStateAction<队列任务记录[]>) => {
      queueTasks = typeof action === 'function' ? action(queueTasks) : action;
    },
    updateGameState: (updater: (current: TeyvatGameState) => TeyvatGameState) => {
      const next = updater(live.current);
      if (next !== live.current) {
        live.current = next;
        writes.push(next);
      }
    },
  } as unknown as UseGameStateReturn;
  return { state, live, writes, readQueueTasks: () => queueTasks };
}

const calibrationParams = (state: UseGameStateReturn) => ({
  state,
  mainApiConfig: {
    id: 'main', name: '主 API', provider: 'openai' as const,
    baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm',
    createdAt: 0, updatedAt: 0,
  },
  userInput: '出发',
  body: '风起了。',
  turnAfter: state.turnCount + 1,
  memorySystemSnapshot: 创建空记忆系统(),
});

/** 真实结算工作流的提交契约：`commitGame` 返回 false 表示 CAS 拒绝（不把 committedGame 交回上游）。 */
function settlementThatProduces(turnCount: number, location: string) {
  return async (params: { currentGame: TeyvatGameState; commitGame: (next: TeyvatGameState) => boolean }) => {
    const next: TeyvatGameState = normalizeTeyvatGameState({
      ...params.currentGame,
      turnCount,
      世界: { ...params.currentGame.世界, 当前地点: location },
    });
    const applied = params.commitGame(next) !== false;
    const batch = { id: 'vbatch_test', turn: turnCount, timestamp: 1, source: 'main' as const, results: [] };
    return applied ? { committedGame: next, batch } : { batch };
  };
}

describe('settlement commit must land on the live root', () => {
  beforeEach(() => {
    spies.runVariableSettlementWorkflow.mockReset();
  });

  it('commits (and advances turnCount) in the normal flow where the render snapshot lacks this turn\'s user message', async () => {
    // 第 2 回合开始前的根（= 本次发送那次渲染的快照）
    const staleSnapshot = buildRoot({ turnCount: 1, conversationId: 'turn-1', location: '清泉镇', playerId: '旅行者' });
    // 活体根：`prepareSendTurn` 已经写入本回合 user 消息
    const liveAfterPrepare = normalizeTeyvatGameState({
      ...staleSnapshot,
      对话: {
        entries: [
          ...staleSnapshot.对话.entries,
          { id: 'turn-2-user', role: 'user' as const, content: '继续走', timestamp: 3, gameTime: '1' },
        ],
      },
    });
    const harness = buildStateHarness(staleSnapshot, liveAfterPrepare);

    // 反例证据：这正是修复前的 CAS 基准（渲染快照 vs 活体根）——必然不等。
    expect(
      isSamePostSettlementSave(
        capturePostSettlementSaveToken(liveAfterPrepare),
        capturePostSettlementSaveToken(staleSnapshot),
      ),
    ).toBe(false);

    spies.runVariableSettlementWorkflow.mockImplementation(settlementThatProduces(2, '蒙德城'));

    const result = await runVariableCalibrationStep(calibrationParams(harness.state));

    // 用户可见的症状就是这两条：回合数必须增长、结算必须落地。
    expect(harness.live.current.turnCount).toBe(2);
    expect(harness.live.current.世界.当前地点).toBe('蒙德城');
    expect(result?.committedGame).toBeDefined();
    expect(harness.writes).toHaveLength(1);
    // 本回合 user 消息必须还在（提交不得回退主流程自己的写入）
    expect(harness.live.current.对话.entries.map((entry) => entry.id)).toContain('turn-2-user');
  });

  it('keeps the player\'s mid-wait edit and still applies the rest of the settlement', async () => {
    const staleSnapshot = buildRoot({ turnCount: 1, conversationId: 'turn-1', location: '清泉镇', playerId: '旅行者' });
    const liveAfterPrepare = normalizeTeyvatGameState({
      ...staleSnapshot,
      对话: {
        entries: [...staleSnapshot.对话.entries, { id: 'turn-2-user', role: 'user' as const, content: '继续走', timestamp: 3, gameTime: '1' }],
      },
    });
    const harness = buildStateHarness(staleSnapshot, liveAfterPrepare);
    const playerInventory = { ...harness.live.current.背包, mora: 999 };
    spies.runVariableSettlementWorkflow.mockImplementation(async (params: {
      currentGame: TeyvatGameState;
      commitGame: (next: TeyvatGameState) => boolean;
    }) => {
      // 等待期间玩家在右侧面板改了背包
      harness.live.current = { ...harness.live.current, 背包: playerInventory };
      const next = normalizeTeyvatGameState({
        ...params.currentGame,
        turnCount: 2,
        背包: { ...params.currentGame.背包, mora: 100 },
        世界: { ...params.currentGame.世界, 当前地点: '蒙德城' },
      });
      const applied = params.commitGame(next);
      return applied ? { committedGame: next, batch: undefined } : { batch: undefined };
    });

    const result = await runVariableCalibrationStep(calibrationParams(harness.state));

    expect(harness.live.current.背包.mora).toBe(999);
    expect(harness.live.current.turnCount).toBe(2);
    expect(harness.live.current.世界.当前地点).toBe('蒙德城');
    expect(result?.committedGame).toBeDefined();
    expect(harness.readQueueTasks().some((task) => task.detail?.includes('背包'))).toBe(true);
  });

  it('discards the settlement and reports no committedGame when another save was loaded mid-wait', async () => {
    const staleSnapshot = buildRoot({ turnCount: 1, conversationId: 'turn-1', location: '清泉镇', playerId: '旅行者' });
    const liveAfterPrepare = normalizeTeyvatGameState({
      ...staleSnapshot,
      对话: {
        entries: [...staleSnapshot.对话.entries, { id: 'turn-2-user', role: 'user' as const, content: '继续走', timestamp: 3, gameTime: '1' }],
      },
    });
    const otherSave = buildRoot({ turnCount: 6, conversationId: 'other', location: '稻妻城', playerId: '另一个人' });
    const harness = buildStateHarness(staleSnapshot, liveAfterPrepare);
    spies.runVariableSettlementWorkflow.mockImplementation(async (params: {
      currentGame: TeyvatGameState;
      commitGame: (next: TeyvatGameState) => boolean;
    }) => {
      // 等待期间玩家读入另一份存档
      harness.live.current = otherSave;
      const next = normalizeTeyvatGameState({ ...params.currentGame, turnCount: 2, 世界: { ...params.currentGame.世界, 当前地点: '蒙德城' } });
      const applied = params.commitGame(next) !== false;
      return applied ? { committedGame: next, batch: undefined } : { batch: undefined };
    });

    const result = await runVariableCalibrationStep(calibrationParams(harness.state));

    expect(result?.committedGame).toBeUndefined();
    expect(harness.live.current).toBe(otherSave);
    expect(harness.live.current.turnCount).toBe(6);
    expect(harness.writes).toHaveLength(0);
    expect(harness.readQueueTasks().some((task) => task.status === 'failed')).toBe(true);
  });
});
