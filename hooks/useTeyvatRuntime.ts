import { useCallback, useState } from 'react';
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
  buildTeyvatSavePayload: () => TeyvatSaveData;
}

export function useTeyvatRuntime(): TeyvatRuntime {
  const [game, setGame] = useState<TeyvatGameState>(createEmptyTeyvatGameState);

  const replaceGameState = useCallback((next: TeyvatGameState) => {
    setGame(normalizeTeyvatGameState(next));
  }, []);

  const updateGameState = useCallback((updater: TeyvatStateUpdater) => {
    setGame((current) => updateTeyvatState(current, updater));
  }, []);

  const buildTeyvatSavePayload = useCallback(
    (): TeyvatSaveData => normalizeTeyvatGameState(game),
    [game],
  );

  return { game, replaceGameState, updateGameState, buildTeyvatSavePayload };
}
