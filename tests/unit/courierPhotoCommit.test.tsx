// @vitest-environment jsdom
import { act, createElement, StrictMode, useCallback, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState, type TeyvatGameState } from '@/models/teyvat/state';
import { useCourierPhotoCommit } from '@/hooks/useCourierPhotoCommit';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('phone photo live-root acknowledgement', () => {
  it('acknowledges the actual synchronous root update and rejects unchanged or switched sessions', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    let session = 1;
    let commit!: ReturnType<typeof useCourierPhotoCommit>;
    const getSession = () => session;
    function Harness() {
      const [game, setGame] = useState(createEmptyTeyvatGameState);
      const update = useCallback((updater: (previous: TeyvatGameState) => TeyvatGameState) => setGame(updater), []);
      const commitPhoto = useCourierPhotoCommit(update, getSession);
      useLayoutEffect(() => { commit = commitPhoto; }, [commitPhoto]);
      return createElement('p', null, String(game.turnCount));
    }
    try {
      await act(async () => root.render(createElement(StrictMode, null, createElement(Harness))));
      await act(async () => {
        expect(commit(previous => ({ ...previous, turnCount: 5 }), 1)).toBe(true);
        expect(host.textContent).toBe('5');
        expect(commit(previous => previous, 1)).toBe(false);
      });
      session = 2;
      const staleUpdater = vi.fn(previous => ({ ...previous, turnCount: 99 }));
      await act(async () => { expect(commit(staleUpdater, 1)).toBe(false); });
      expect(staleUpdater).not.toHaveBeenCalled();
      expect(host.textContent).toBe('5');
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
