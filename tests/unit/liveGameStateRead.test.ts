// @vitest-environment jsdom
import { act, createElement, useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState, type TeyvatGameState } from '@/models/teyvat';
import { updateTeyvatState } from '@/hooks/useTeyvatRuntime';
import { readLiveGameState, type UseGameStateReturn } from '@/hooks/useGameState';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * `readLiveGameState` 的**真实 React 语义**验证（假 dispatcher 证明不了这些）：
 * 长耗时工作流持有的是「本次发送开始那次渲染」的快照对象，`snapshot.game` 之后不会再变
 * （`hooks/useGame.ts` 的 `stateRef.current` 捕获 + `UseGameStateReturn` 每次渲染一份）。
 * 变量结算的 CAS 基准与并发合并祖先都必须取「活体根」，所以这个探测必须：
 *  1) 看得到**尚未渲染**的写入（`setState` 已入队，React 还没重渲染）；
 *  2) 返回的就是 React 内部那个活体对象（引用相等），不是重建出来的副本；
 * 边界（如实记录）：`flushSync` 会**同步完成**已排队的 React 更新，因此这次探测可能让
 * 一次渲染提前发生（渲染计数会 +1，见下面第二条用例）。它不会**改变状态** ——
 * updater 返回同一个引用，`updateTeyvatState` 直接返回 `current`，
 * 这正是「同步读到活体根」的代价，也是本仓库既有的 `commitPostSettlementBackgroundState` 同款做法。
 *
 * 来源：2026-09-20 对抗审查的 A 探针（独立复现「快照看不到未渲染写入 / 活体根可以」）。
 */
describe('readLiveGameState reads the live React root', () => {
  let host: HTMLDivElement;
  let root: Root;
  let api: UseGameStateReturn | null;
  let renderCount = 0;
  const committed = { current: null as TeyvatGameState | null };

  function Harness() {
    const [game, setGame] = useState<TeyvatGameState>(() => normalizeTeyvatGameState(createEmptyTeyvatGameState()));
    const updateGameState = useCallback(
      (updater: (current: TeyvatGameState) => TeyvatGameState) =>
        setGame((current) => updateTeyvatState(current, updater)),
      [],
    );
    const value = useMemo(
      () => ({ game, updateGameState }) as unknown as UseGameStateReturn,
      [game, updateGameState],
    );
    useLayoutEffect(() => {
      committed.current = game;
    }, [game]);
    api = value;
    renderCount += 1;
    return createElement('span', null, `turn:${game.turnCount}|msgs:${game.对话.entries.length}`);
  }

  beforeEach(async () => {
    renderCount = 0;
    api = null;
    committed.current = null;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(createElement(Harness));
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('sees a write that has not been rendered yet and returns the identical live object', async () => {
    const sendStartSnapshot = api!;
    expect(sendStartSnapshot.game.对话.entries).toHaveLength(0);

    // prepareSendTurn 通过这份旧快照的 updateGameState 落 user 消息（React 批处理，尚未渲染）
    sendStartSnapshot.updateGameState((current) => ({
      ...current,
      对话: { entries: [...current.对话.entries, { id: 'u-1', role: 'user' as const, content: '走', timestamp: 1 }] },
    }));
    expect(sendStartSnapshot.game.对话.entries).toHaveLength(0);

    const live = readLiveGameState(sendStartSnapshot);

    expect(live.对话.entries.map((entry) => entry.id)).toEqual(['u-1']);
    expect(live).toBe(committed.current);
    expect(live).not.toBe(sendStartSnapshot.game);
  });

  it('keeps the same root even though flushSync may trigger an extra render', async () => {
    await act(async () => {
      api!.updateGameState((current) => ({
        ...current,
        对话: { entries: [...current.对话.entries, { id: 'u-2', role: 'user' as const, content: '走', timestamp: 2 }] },
      }));
    });
    const before = renderCount;

    const live = readLiveGameState(api!);

    expect(live).toBe(committed.current);
    expect(renderCount).toBe(before + 1);
    expect(host.textContent).toBe('turn:0|msgs:1');
  });
});
