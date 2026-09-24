// @vitest-environment jsdom
import { act, createElement, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState, type TeyvatGameState } from '@/models/teyvat';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import {
  capturePostSettlementSaveToken,
  commitPostSettlementBackgroundState,
} from '@/hooks/useGame/postSettlementRecoveryWorkflow';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 用**真实 React 状态**验证跨 await 的提交守卫（假 dispatcher 证明不了 React 语义）：
 * updater 形式拿到的必须是提交那一刻的活体存档，且 `flushSync` 必须在返回前完成提交——
 * 否则「状态没写、却把旧快照落盘」的二次损坏就防不住。
 */
describe('post-settlement recovery CAS commit', () => {
  let messageSequence = 0;
  let host: HTMLDivElement;
  let root: Root;
  let initialState: TeyvatGameState;
  let stateApi: UseGameStateReturn | null;
  let replaceLive: ((next: TeyvatGameState) => void) | null;
  let readLive: (() => TeyvatGameState) | null;

  function Harness() {
    const [game, setGame] = useState<TeyvatGameState>(() => initialState);
    // 渲染期同步记录当前活体根：提交后 act 会冲刷渲染，读到的就是提交结果。
    const latest = useRef(game);
    latest.current = game;
    stateApi = useMemo(
      () => ({
        updateGameState: (updater: (current: TeyvatGameState) => TeyvatGameState) =>
          setGame((current) => updater(current)),
      }) as unknown as UseGameStateReturn,
      [],
    );
    useEffect(() => {
      replaceLive = (next: TeyvatGameState) => setGame(next);
      readLive = () => latest.current;
    }, []);
    return createElement('span', null, `turn:${game.turnCount}`);
  }

  function buildSave(turnCount: number, content: string): TeyvatGameState {
    const save = createEmptyTeyvatGameState();
    save.turnCount = turnCount;
    // id 沿用生产环境 创建聊天消息 的方案（时间戳 + 自增计数）：跨存档重名只是测试夹具的假象，
    // 真实存档的 id 带时间戳，两份存档不会共用同一条消息 id。
    save.对话.entries.push({
      id: `msg_${Date.now()}_${++messageSequence}`,
      role: 'user',
      content,
      timestamp: turnCount,
      gameTime: String(turnCount),
    });
    return normalizeTeyvatGameState(save);
  }

  beforeEach(async () => {
    initialState = buildSave(2, '去清泉镇');
    stateApi = null;
    replaceLive = null;
    readLive = null;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(Harness));
    });
    expect(host.textContent).toBe('turn:2');
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('commits synchronously when the live save is still the one the recovery started on', () => {
    const token = capturePostSettlementSaveToken(initialState);
    const next = normalizeTeyvatGameState({ ...initialState, turnCount: 3 });

    let committed: TeyvatGameState | null = null;
    act(() => {
      committed = commitPostSettlementBackgroundState(stateApi!, token, next, initialState);
    });

    expect((committed as TeyvatGameState | null)?.turnCount).toBe(3);
    // flushSync 已同步提交：DOM 立刻反映新状态，落盘才不会写到过期快照。
    expect(host.textContent).toBe('turn:3');
  });

  it('keeps a player edit made while the tail was awaiting (A3 class)', async () => {
    const token = capturePostSettlementSaveToken(initialState);
    const next = normalizeTeyvatGameState({ ...initialState, turnCount: 3, 世界: { ...initialState.世界, 当前地点: '蒙德城' } });
    // 正文生图等待期间玩家在右侧面板改了背包（活体根换了背包切片引用）
    const playerInventory = { ...initialState.背包, mora: 999 };
    await act(async () => {
      replaceLive!({ ...initialState, 背包: playerInventory });
    });

    let committed: TeyvatGameState | null = null;
    act(() => {
      committed = commitPostSettlementBackgroundState(stateApi!, token, next, initialState);
    });

    expect((committed as TeyvatGameState | null)?.turnCount).toBe(3);
    // 结算尾流程的结果要落地，玩家的并发改动也不能被整根替换静默回退。
    expect(host.textContent).toBe('turn:3');
    expect(readLive!().世界.当前地点).toBe('蒙德城');
    expect(readLive!().背包.mora).toBe(999);
    // 自动存档必须使用这份实际提交的合并根，而不是生图前计算的 next。
    expect(committed && typeof committed === 'object'
      ? (committed as TeyvatGameState).背包.mora
      : undefined).toBe(999);
  });

  it('writes nothing when another save was loaded while the tail was awaiting', async () => {
    const token = capturePostSettlementSaveToken(initialState);
    const otherSave = buildSave(7, '前往稻妻');
    await act(async () => {
      replaceLive!(otherSave);
    });
    expect(host.textContent).toBe('turn:7');

    const staleBackground = normalizeTeyvatGameState({ ...initialState, turnCount: 3 });
    let committed: TeyvatGameState | null = null;
    act(() => {
      committed = commitPostSettlementBackgroundState(stateApi!, token, staleBackground, initialState);
    });

    expect(committed).toBeNull();
    expect(host.textContent).toBe('turn:7');
  });

  it('detects a switch that keeps the turn count but replaces the conversation', async () => {
    const token = capturePostSettlementSaveToken(initialState);
    const otherSave = buildSave(2, '完全不同的输入');
    await act(async () => {
      replaceLive!(otherSave);
    });

    let committed: TeyvatGameState | null = null;
    act(() => {
      committed = commitPostSettlementBackgroundState(
        stateApi!,
        token,
        normalizeTeyvatGameState({ ...initialState, turnCount: 3 }),
        initialState,
      );
    });

    expect(committed).toBeNull();
    expect(host.textContent).toBe('turn:2');
  });
});
