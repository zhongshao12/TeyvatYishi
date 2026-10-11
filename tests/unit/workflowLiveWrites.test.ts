import { beforeEach, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState, type TeyvatGameState } from '@/models/teyvat';
import { type UseGameStateReturn, toLegacyTurnCheckpoint } from '@/hooks/useGameState';
import { createWorkflowRecoveryJournal } from '@/utils/workflowRecoveryModel';
import { unlockElement } from '@/services/elementalAttunementService';

const persistence = vi.hoisted(() => ({ wait: vi.fn(async (): Promise<void> => undefined) }));
vi.mock('@/services/workflowRecovery', async (original) => ({
  ...(await original<typeof import('@/services/workflowRecovery')>()),
  persistWorkflowRecoveryJournal: persistence.wait,
}));
import { prepareSendTurn } from '@/hooks/useGame/sendPreparationStage';
import { runElementalSettlementStage } from '@/hooks/useGame/elementalSettlementStage';

function harness(root: TeyvatGameState) {
  let live = root;
  let session = 1;
  const snapshot = toLegacyTurnCheckpoint({ traveler: root.旅行者, npc: root.NPC, album: root.相册, turnCount: root.turnCount, pendingOpeningTrigger: null });
  const state = {
    ...snapshot, game: root, chatHistory: root.对话.entries, variableBatches: [], queueTasks: [],
    getGameSessionId: () => session,
    setChatHistory: (history: TeyvatGameState['对话']['entries']) => { live = { ...live, 对话: { entries: history } }; },
    set旅人: (next: UseGameStateReturn['旅人']) => { live = { ...live, 旅行者: { ...live.旅行者, ...next } }; },
    updateGameState: (update: (game: TeyvatGameState) => TeyvatGameState) => { live = update(live); },
    setQueueTasks: vi.fn(),
  } as unknown as UseGameStateReturn;
  return { state, live: () => live, replace: (next: TeyvatGameState) => { live = next; session++; }, edit: (next: TeyvatGameState) => { live = next; } };
}
beforeEach(() => { persistence.wait.mockReset().mockResolvedValue(undefined); });

it('does not insert old user/history after a save switch during journal persistence', async () => {
  const a = createEmptyTeyvatGameState();
  a.对话.entries = [{ id: 'a', role: 'user', content: 'A', timestamp: 1 }];
  const h = harness(a);
  let release!: () => void;
  persistence.wait.mockImplementation(() => new Promise<void>((resolve) => { release = resolve; }));
  const job = prepareSendTurn({ state: h.state, userInput: 'old input', effectiveWorld: h.state.世界,
    recoveryJournal: createWorkflowRecoveryJournal('old input', 0),
    onSnapshotReady: () => undefined, onJournalUpdated: () => undefined, onPurgedHistoryReady: () => undefined });
  const b = createEmptyTeyvatGameState();
  b.对话.entries = [{ id: 'b', role: 'user', content: 'B', timestamp: 2 }];
  h.replace(b);
  release();
  await expect(job).rejects.toMatchObject({ name: 'AbortError' });
  expect(h.live().对话.entries.map((message) => message.content)).toEqual(['B']);
});

it('merges elemental mastery into the live traveler without reverting profile edits', async () => {
  const a = createEmptyTeyvatGameState();
  a.旅行者 = unlockElement(a.旅行者, 'anemo', { source: 'traveler_resonance', unlockedAt: '1日' });
  a.旅行者.姓名 = '旧姓名';
  const h = harness(a);
  h.edit({ ...a, 旅行者: { ...a.旅行者, 姓名: '新姓名', 外貌: '已编辑外貌' } });
  await runElementalSettlementStage({ state: h.state, displayText: '旅行者施放风元素攻击。', committedSettlementGame: a,
    variableOverrides: { 旅人: h.state.旅人 } as never });
  expect(h.live().旅行者.姓名).toBe('新姓名');
  expect(h.live().旅行者.外貌).toBe('已编辑外貌');
  expect(h.live().旅行者.元素共鸣[0]?.mastery).toBe(2);
});
