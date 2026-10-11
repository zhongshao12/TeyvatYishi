import { beforeEach, expect, it, vi } from 'vitest';
import { persistMemorySnapshot } from '@/hooks/useGame/memorySaveTask';
import { clearActiveSaveTreeMetaIfMatches, commitActiveSaveTreeMeta } from '@/hooks/useGame/saveLoadWorkflow';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import { 创建空记忆系统 } from '@/models/memory';
import type { UseGameStateReturn } from '@/hooks/useGameState';
const db = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('@/services/dbService', async importActual => ({ ...await importActual<typeof import('@/services/dbService')>(), saveGame: db.save }));
const persist = persistMemorySnapshot as typeof persistMemorySnapshot & ((state: UseGameStateReturn, memory: ReturnType<typeof 创建空记忆系统>, tree: undefined,
  context: { expectedSessionId: number; expectedRootId: string | null; signal?: AbortSignal }) => Promise<void>);
let sessionId = 300;
function state() {
  const game = createEmptyTeyvatGameState();
  return { game, getGameSessionId: () => sessionId, updateGameState: (update: (current: typeof game) => typeof game) => update(game),
    chatHistory: [], variableBatches: [], setHasSave: vi.fn() } as unknown as UseGameStateReturn;
}
function tree(rootId: string) { return { rootId, nodeId: `${rootId}-node`, createdAt: 1 }; }
beforeEach(() => { sessionId++; clearActiveSaveTreeMetaIfMatches(); db.save.mockReset().mockResolvedValue(1); });
it('rejects a changed session, root or cancellation before constructing a save', async () => {
  const s = state(); const oldSession = sessionId;
  sessionId++;
  await expect(persist(s, 创建空记忆系统(), undefined, { expectedSessionId: oldSession, expectedRootId: null })).rejects.toThrow();
  commitActiveSaveTreeMeta({ saveTree: tree('B') });
  await expect(persist(s, 创建空记忆系统(), undefined, { expectedSessionId: sessionId, expectedRootId: null })).rejects.toThrow();
  await expect(persist(s, 创建空记忆系统(), undefined, { expectedSessionId: sessionId, expectedRootId: 'A' })).rejects.toThrow();
  const controller = new AbortController(); controller.abort();
  await expect(persist(s, 创建空记忆系统(), undefined, { expectedSessionId: sessionId, expectedRootId: 'B', signal: controller.signal })).rejects.toThrow();
  expect(db.save).not.toHaveBeenCalled();
});
it('keeps the queued payload on its original save line and never applies completion to a new line', async () => {
  const s = state(); commitActiveSaveTreeMeta({ saveTree: tree('A') });
  let finish!: () => void; db.save.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(1); }));
  const pending = persist(s, 创建空记忆系统(), undefined, { expectedSessionId: sessionId, expectedRootId: 'A' });
  sessionId++; commitActiveSaveTreeMeta({ saveTree: tree('B') }); finish(); await pending;
  expect(db.save.mock.calls[0]?.[0]).toMatchObject({ saveTree: { rootId: 'A' } });
  expect(s.setHasSave).not.toHaveBeenCalled();
});
