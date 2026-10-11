import { useCallback } from 'react';
import { flushSync } from 'react-dom';
import type { TeyvatGameState } from '@/models/teyvat/state';

type UpdateGameState = (update: (current: TeyvatGameState) => TeyvatGameState) => void;

/** Atomic root-state CAS with an acknowledgement, not two independent slice setters. */
export function useCourierPhotoCommit(updateGameState: UpdateGameState, getGameSessionId: () => number) {
  return useCallback((update: (current: TeyvatGameState) => TeyvatGameState, sessionId: number | null) => {
    let accepted = false;
    flushSync(() => updateGameState(current => {
      if (getGameSessionId() !== sessionId) return current;
      const next = update(current);
      accepted = next !== current;
      return next;
    }));
    return accepted;
  }, [updateGameState, getGameSessionId]);
}
