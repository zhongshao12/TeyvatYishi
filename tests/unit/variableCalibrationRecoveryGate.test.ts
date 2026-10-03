import { describe, expect, it, vi } from 'vitest';
import { runVariableCalibrationStage } from '@/hooks/useGame/variableCalibrationStage';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import { 创建默认游戏设置, type API配置项 } from '@/models/settings';
import { toLegacyMemory, toLegacyTraveler, toLegacyWorld, type UseGameStateReturn } from '@/hooks/useGameState';
import { createWorkflowRecoveryJournal, parseWorkflowRecoveryJournal, type WorkflowRecoveryJournal } from '@/utils/workflowRecoveryModel';
import type { NarrativeTurn } from '@/models/teyvat/narrativeTurn';

const failures = vi.hoisted(() => ({ stored: null as WorkflowRecoveryJournal | null }));
vi.mock('@/hooks/useGame/sendWorkflow', () => ({
  runVariableCalibrationStep: async () => { throw new Error('simulated API interruption'); },
}));
vi.mock('@/services/workflowRecovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/workflowRecovery')>()),
  persistWorkflowRecoveryJournal: async (journal: WorkflowRecoveryJournal) => {
    failures.stored = parseWorkflowRecoveryJournal(JSON.parse(JSON.stringify(journal)));
  },
}));

describe('pending settlement recovery gate', () => {
  it('persists the original chapter gate before the interruptible variable request', async () => {
    const game = createEmptyTeyvatGameState();
    game.turnCount = 6;
    const state = {
      game, turnCount: 6, setQueueTasks: () => undefined,
      updateGameState: (updater: (current: typeof game) => typeof game) => { updater(game); },
      gameSettings: 创建默认游戏设置(),
    } as unknown as UseGameStateReturn;
    const parsed: NarrativeTurn = {
      body: [{ kind: 'narration', text: '众人完成了神庙调查。' }],
      choices: [], factCandidates: [], continuation: { summary: '调查结束', unresolved: [] },
    };
    const aiMsg = { id: 'assistant-7', role: 'assistant' as const, content: '众人完成了神庙调查。', timestamp: 2, parsedResponse: parsed };
    const journal = createWorkflowRecoveryJournal('继续调查', 6);
    const gateSnapshot = { mode: 'strong' as const, reasons: ['调查已完成'], 系列ID: 'mondstadt', 分段ID: 'temple', 分段组号: 2 };
    await expect(runVariableCalibrationStage({
      state, userInput: '继续调查', config: {} as API配置项,
      abortController: new AbortController(), assertWorkflowActive: () => undefined, isCurrentWorkflow: () => true,
      isOpeningSystemTrigger: false, effectiveWorld: toLegacyWorld(game), displayText: aiMsg.content,
      parsedForDisplay: parsed, aiMsg, openingSteambirdForSave: null, openingSteambirdPreprocessed: false,
      storyWeavingGate: gateSnapshot, irminsulEnabled: true, irminsulRecallEnabled: false, irminsulPreview: null,
      irminsulWithCompression: game.世界树, worldAfter: toLegacyWorld(game), travelerAfter: toLegacyTraveler(game),
      worldFactCandidates: [], finalHistory: [{ id: 'user-7', role: 'user', content: '继续调查', timestamp: 1 }, aiMsg],
      mem: toLegacyMemory(game), recoveryJournal: journal, onJournalUpdated: () => undefined,
    })).rejects.toThrow('simulated API interruption');
    expect(failures.stored?.phase).toBe('settlement_pending');
    expect(failures.stored?.storyAlignment).toEqual({ openingSystemTurn: false, gateSnapshot });
    expect(failures.stored?.pendingSettlement?.source.对话.entries.map((message) => message.id))
      .toEqual(['user-7', 'assistant-7']);
  });
});
