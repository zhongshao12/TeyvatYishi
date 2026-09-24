// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useTeyvatRuntime, type TeyvatRuntime } from '@/hooks/useTeyvatRuntime';
import { createEmptyTeyvatGameState } from '@/models/teyvat';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('game session identity', () => {
  it('invalidates callbacks from before a save load or a new-game reset', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let runtime: TeyvatRuntime | null = null;
    function Harness() {
      runtime = useTeyvatRuntime();
      return createElement('span', null, runtime.game.turnCount);
    }
    try {
      await act(async () => root.render(createElement(Harness)));
      const current = () => runtime as TeyvatRuntime & {
        getGameSessionId?: () => number;
        invalidateGameSession?: () => void;
      };
      const before = current().getGameSessionId?.() ?? 0;
      await act(async () => current().replaceGameState({ ...createEmptyTeyvatGameState(), turnCount: 4 }));
      expect(current().getGameSessionId?.() ?? 0).toBe(before + 1);
      await act(async () => current().invalidateGameSession?.());
      expect(current().getGameSessionId?.() ?? 0).toBe(before + 2);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
