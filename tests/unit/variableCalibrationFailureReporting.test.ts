import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { runVariableCalibrationStage, type VariableCalibrationDeps } from '@/hooks/useGame/variableCalibrationStage';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import { 创建默认游戏设置, type API配置项 } from '@/models/settings';
import { toLegacyMemory, toLegacyTraveler, toLegacyWorld, type UseGameStateReturn } from '@/hooks/useGameState';
import { createWorkflowRecoveryJournal } from '@/utils/workflowRecoveryModel';

const step = vi.hoisted(() => ({ run: vi.fn(), news: vi.fn() }));
vi.mock('@/hooks/useGame/sendWorkflow', () => ({ runVariableCalibrationStep: step.run }));
vi.mock('@/services/workflowRecovery', async original => ({
  ...await original<object>(), persistWorkflowRecoveryJournal: async () => undefined,
}));
vi.mock('@/hooks/useGame/postTurnBackgroundTasks', async original => ({
  ...await original<object>(), runSteambirdPostTurnTask: step.news,
  runPostTurnBackgroundTasks: async (jobs: { steambird: () => Promise<void> }) => jobs.steambird(),
}));
vi.mock('@/hooks/useGame/memoryUpdateStage', () => ({
  runMemoryUpdateStage: async (deps: { memory: unknown; irminsul: unknown }) => ({ mem: deps.memory, irminsulWithCompression: deps.irminsul }),
}));

function input(): VariableCalibrationDeps {
  const game = createEmptyTeyvatGameState();
  const parsed = { body: [{ kind: 'narration' as const, text: '风吹过蒙德城。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } };
  const aiMsg = { id: 'ai-1', role: 'assistant' as const, content: '风吹过蒙德城。', timestamp: 2, parsedResponse: parsed };
  return {
    state: { game, turnCount: 0, setQueueTasks: () => undefined,
      updateGameState: (updater: (current: typeof game) => typeof game) => updater(game),
      gameSettings: 创建默认游戏设置() } as unknown as UseGameStateReturn,
    userInput: '继续', config: {} as API配置项, abortController: new AbortController(),
    assertWorkflowActive: () => undefined, isCurrentWorkflow: () => true,
    isOpeningSystemTrigger: false, effectiveWorld: toLegacyWorld(game), displayText: aiMsg.content,
    parsedForDisplay: parsed, aiMsg, openingSteambirdForSave: null, openingSteambirdPreprocessed: false,
    storyWeavingGate: null, irminsulEnabled: false, irminsulRecallEnabled: false, irminsulPreview: null,
    irminsulWithCompression: game.世界树, worldAfter: toLegacyWorld(game), travelerAfter: toLegacyTraveler(game),
    worldFactCandidates: [], finalHistory: [aiMsg], mem: toLegacyMemory(game),
    recoveryJournal: createWorkflowRecoveryJournal('继续', 0), onJournalUpdated: () => undefined,
  };
}

describe('settlement stage error reporting', () => {
  it('does not append a skipped news diagnostic into a save switched while the task awaited', async () => {
    const deps = input();
    let live = deps.state.game, active = true;
    let queue: Array<{ task?: string; type?: string; status: string }> = [];
    deps.state.getGameSessionId = () => active ? 1 : 2;
    deps.state.NPC = []; deps.state.chatHistory = deps.finalHistory;
    deps.state.旅人 = deps.travelerAfter; deps.state.世界 = deps.worldAfter;
    deps.state.记忆 = deps.mem; deps.state.手机 = live.手机;
    deps.state.世界树 = live.世界树; deps.state.蒸汽鸟报 = live.蒸汽鸟报;
    deps.state.apiSettings = { activeConfigId: null, configs: [] };
    deps.state.setQueueTasks = update => { queue = (typeof update === 'function' ? update(queue as never) : update) as typeof queue; };
    deps.state.updateGameState = update => { live = update(live); };
    deps.assertWorkflowActive = () => { if (!active) throw new DOMException('旧回合已停止', 'AbortError'); };
    deps.isCurrentWorkflow = () => active;
    step.run.mockImplementationOnce(async (params: { baseGameSnapshot: typeof live }) => {
      live = { ...params.baseGameSnapshot, 叙事: { ...params.baseGameSnapshot.叙事,
        lastCommittedMoment: { worldName: '提瓦特', date: '1000.03.11', clock: '10:00', weather: '晴', location: '蒙德', travelDay: 1, turn: 1, settlementId: deps.recoveryJournal.workflowId },
      } };
      return { committedGame: live };
    });
    step.news.mockImplementationOnce(async () => {
      active = false; queue = [];
      return { news: { articles: [] }, status: 'skipped', changed: false, detail: '存档已切换，旧报纸结果已丢弃。' };
    });
    await expect(runVariableCalibrationStage(deps)).rejects.toMatchObject({ name: 'AbortError' });
    expect(queue).toEqual([]);
  });
  it('surfaces the model failure instead of the generic save-switch message', async () => {
    step.run.mockResolvedValueOnce({ failure: { code: 'VARIABLE_MODEL_FAILED', detail: 'API Error 429: variable quota exhausted' } });
    await expect(runVariableCalibrationStage(input())).rejects.toThrow('API Error 429: variable quota exhausted');
  });
  it('routes cancellation to AbortError rather than a main-flow failure', async () => {
    const deps = input();
    step.run.mockImplementationOnce(async () => { deps.abortController.abort(); return null; });
    await expect(runVariableCalibrationStage(deps)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('keeps legacy batch diagnostics when a result lacks explicit failure metadata', async () => {
    step.run.mockResolvedValueOnce({ batch: { results: [{ ok: false, reason: '变量输出无法解析，请检查模型输出。' }] } });
    await expect(runVariableCalibrationStage(input())).rejects.toThrow('变量输出无法解析');
  });
});
