// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useGame, type UseGameReturn } from '@/hooks/useGame';
import { createLegacyGameViewSelector, type UseGameStateReturn } from '@/hooks/useGameState';
import { useTeyvatRuntime, type TeyvatRuntime } from '@/hooks/useTeyvatRuntime';
import { 创建默认游戏设置, 创建空API设置 } from '@/models/settings';
import { clearActiveSaveTreeMetaIfMatches } from '@/hooks/useGame/saveLoadWorkflow';

const io = vi.hoisted(() => ({ state: null as unknown, save: vi.fn() }));
vi.mock('@/hooks/useGameState', async original => ({ ...await original<typeof import('@/hooks/useGameState')>(), useGameState: () => io.state }));
vi.mock('@/services/dbService', async original => ({ ...await original<typeof import('@/services/dbService')>(), saveSetting: io.save }));
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

it('reports a rejected restart settings write without an unhandled rejection or changing a later session', async () => {
  const select = createLegacyGameViewSelector();
  let api!: UseGameReturn, runtime!: TeyvatRuntime, hint = '';
  let reject!: (reason: Error) => void;
  io.save.mockReset().mockImplementation(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  function Harness() {
    runtime = useTeyvatRuntime();
    const [workflowHint, setWorkflowHint] = useState(''); hint = workflowHint;
    const [, setPendingOpeningTrigger] = useState<string | null>(null);
    io.state = { ...select(runtime.game), ...runtime, setWorkflowHint, setPendingOpeningTrigger,
      loading: false, gameSettings: 创建默认游戏设置(), apiSettings: 创建空API设置(),
    } as unknown as UseGameStateReturn;
    api = useGame(); return null;
  }
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => api.actions.handleRestartOpening());
    expect(io.save).toHaveBeenCalledOnce();
    await act(async () => reject(new Error('fixture settings write denied')));
    expect(hint).toContain('保存失败');
    expect(runtime.game.turnCount).toBe(1);
    await act(async () => api.actions.handleRestartOpening());
    await act(async () => { runtime.invalidateGameSession(); (io.state as UseGameStateReturn).setWorkflowHint('新会话提示'); });
    await act(async () => reject(new Error('fixture old request failed')));
    expect(hint).toBe('新会话提示');
  } finally {
    await act(async () => root.unmount()); host.remove(); clearActiveSaveTreeMetaIfMatches();
  }
});
