import { useCallback, useRef, useState } from 'react';
import { registerStorySettingSession } from '@/services/storySettingIdentity';
import {
  createEmptyTeyvatGameState,
  normalizeTeyvatGameState,
  type TeyvatGameState,
  type TeyvatSaveData,
} from '@/models/teyvat';

export type TeyvatStateUpdater = (current: TeyvatGameState) => TeyvatGameState;

export function updateTeyvatState(
  current: TeyvatGameState,
  updater: TeyvatStateUpdater,
): TeyvatGameState {
  const next = updater(current);
  return next === current ? current : next;
}

export interface TeyvatRuntime {
  game: TeyvatGameState;
  replaceGameState: (next: TeyvatGameState) => void;
  updateGameState: (updater: TeyvatStateUpdater) => void;
  getGameSessionId: () => number;
  invalidateGameSession: () => void;
  buildTeyvatSavePayload: () => TeyvatSaveData;
}

/**
 * 模块级「当前对局身份」读数。
 *
 * 相册面板的手动生图 / AI 锚点提取要跨多次 await，提交时用的 setter 来自启动那一次渲染；
 * 期间读档或开新档会让那个 setter 写进新档（P1-B02）。面板在渲染期把自己的会话号与这里
 * 比对即可判定跨档。写在 `useTeyvatRuntime` 的渲染里，所以它读的永远是当前档。
 */
let liveGameSessionAlias: (() => number) | null = null;

export function registerLiveGameSessionAlias(reader: (() => number) | null): void {
  liveGameSessionAlias = reader;
  registerStorySettingSession(reader);
}

/** 读取当前对局身份；从未登记过（例如没挂 runtime 的单测）时返回 undefined。 */
export function getLiveGameSessionId(): number | undefined {
  return liveGameSessionAlias?.();
}

export function useTeyvatRuntime(): TeyvatRuntime {
  const [game, setGame] = useState<TeyvatGameState>(createEmptyTeyvatGameState);
  const gameSessionIdRef = useRef(0);

  const getGameSessionId = useCallback(() => gameSessionIdRef.current, []);
  const invalidateGameSession = useCallback(() => { gameSessionIdRef.current += 1; }, []);
  // 把活体身份登记到模块级读数：相册等异步面板在一次 await 之后要按它核对是否已跨档
  // （P1-B02）。登记在每次渲染执行，读到的永远是当前那一档。
  registerLiveGameSessionAlias(getGameSessionId);

  const replaceGameState = useCallback((next: TeyvatGameState) => {
    gameSessionIdRef.current += 1;
    setGame(normalizeTeyvatGameState(next));
  }, []);

  const updateGameState = useCallback((updater: TeyvatStateUpdater) => {
    setGame((current) => updateTeyvatState(current, updater));
  }, []);

  const buildTeyvatSavePayload = useCallback(
    (): TeyvatSaveData => normalizeTeyvatGameState(game),
    [game],
  );

  return { game, replaceGameState, updateGameState, getGameSessionId, invalidateGameSession, buildTeyvatSavePayload };
}
