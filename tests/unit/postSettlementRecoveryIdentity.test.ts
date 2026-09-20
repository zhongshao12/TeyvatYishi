import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState, type TeyvatGameState, type TeyvatSaveData } from '../../models/teyvat';
import { 创建默认游戏设置 } from '../../models/settings';
import type { UseGameStateReturn } from '../../hooks/useGameState';
import { parseWorkflowRecoveryJournal } from '../../utils/workflowRecoveryModel';

const spies = vi.hoisted(() => ({
  saveGame: vi.fn(async (_save: TeyvatSaveData) => 1),
  persist: vi.fn(async () => undefined),
  generateImages: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock('../../services/dbService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/dbService')>()),
  saveGame: spies.saveGame,
}));

vi.mock('../../services/workflowRecovery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/workflowRecovery')>()),
  persistWorkflowRecoveryJournal: spies.persist,
}));

vi.mock('../../hooks/useGame/narrativeImageWorkflow', () => ({
  resolveNarrativeImageGenerationApi: () => ({ id: 'image-api' }),
  resolveNarrativeImageTokenizerConfig: () => null,
  generateNarrativeImagesForMessage: spies.generateImages,
}));

import { resumeCommittedSettlementWorkflow } from '../../hooks/useGame/sendWorkflow';

/** 已提交回合（journal.committedState）对应的存档根。 */
function buildCommittedRoot(): TeyvatGameState {
  const committed = createEmptyTeyvatGameState();
  committed.turnCount = 3;
  committed.世界.当前地点 = '蒙德城';
  committed.对话.entries.push(
    { id: 'user-3', role: 'user', content: '去蒙德城', timestamp: 10, gameTime: '2' },
    {
      id: 'assistant-3', role: 'assistant', content: '蒙德城的钟声响起。', timestamp: 11, gameTime: '2',
      structuredResponse: {
        body: [{ kind: 'narration', text: '蒙德城的钟声响起。' }], choices: [], factCandidates: [],
        continuation: { summary: '抵达蒙德城', unresolved: [] },
      },
    },
  );
  return normalizeTeyvatGameState(committed);
}

/** 第 3 回合开始前的存档（页面重载后 React 根里就是这份「旧根」）。 */
function buildStaleRoot(): TeyvatGameState {
  const stale = createEmptyTeyvatGameState();
  stale.turnCount = 2;
  stale.世界.当前地点 = '清泉镇';
  stale.对话.entries.push({ id: 'user-2', role: 'user', content: '去清泉镇', timestamp: 9, gameTime: '1' });
  return normalizeTeyvatGameState(stale);
}

/** 玩家在等待期间读入的另一份存档。 */
function buildOtherSave(): TeyvatGameState {
  const other = createEmptyTeyvatGameState();
  other.turnCount = 7;
  other.世界.当前地点 = '稻妻城';
  other.旅行者.姓名 = '另一份存档的旅行者';
  other.对话.entries.push(
    { id: 'user-7', role: 'user', content: '前往稻妻', timestamp: 20, gameTime: '6' },
    { id: 'assistant-7', role: 'assistant', content: '雷光落下。', timestamp: 21, gameTime: '6' },
  );
  return normalizeTeyvatGameState(other);
}

function buildJournal(committed: TeyvatGameState) {
  return parseWorkflowRecoveryJournal({
    version: 3, workflowId: 'identity-3', startedAt: 11, updatedAt: 11, input: '去蒙德城', turnAtStart: 2,
    phase: 'settlement_committed', phaseStartedAt: 11, assistantMessageId: 'assistant-3', committedState: committed,
  })!;
}

/**
 * 复刻 UseGameStateReturn 的真实语义：
 *  - `game` 是渲染快照（await 之后仍是旧值，读档后不会自己变）；
 *  - `replaceGameState` 无条件覆盖活体存档；
 *  - `updateGameState` 的 updater 拿到**提交那一刻**的活体存档（React 的 current 语义）。
 */
function buildStateHarness(staleRoot: TeyvatGameState, initialLive: TeyvatGameState) {
  const live = { current: initialLive };
  const writes: TeyvatGameState[] = [];
  const setHasSave = vi.fn();
  const state = {
    game: staleRoot,
    chatHistory: [],
    variableBatches: [],
    NPC: [],
    旅人: {} as UseGameStateReturn['旅人'],
    相册: {} as UseGameStateReturn['相册'],
    gameSettings: 创建默认游戏设置(),
    apiSettings: { activeConfigId: '', configs: [] },
    replaceGameState: (next: TeyvatGameState) => {
      live.current = normalizeTeyvatGameState(next);
      writes.push(live.current);
    },
    updateGameState: (updater: (current: TeyvatGameState) => TeyvatGameState) => {
      const next = updater(live.current);
      if (next !== live.current) {
        live.current = next;
        writes.push(next);
      }
    },
    setHasSave,
  } as unknown as UseGameStateReturn;
  return { state, live, writes, setHasSave };
}

function enableNarrativeImages(state: UseGameStateReturn): void {
  state.gameSettings.文生图系统.正文生图.enabled = true;
  state.gameSettings.文生图系统.正文生图.mode = 'auto';
}

describe('post-settlement recovery must not overwrite a save loaded during its long await', () => {
  beforeEach(() => {
    spies.saveGame.mockClear();
    spies.persist.mockClear();
    spies.generateImages.mockReset();
    spies.generateImages.mockResolvedValue([]);
  });

  it('discards the recovery tail when the active save changed while narrative images were generating', async () => {
    const committed = buildCommittedRoot();
    const staleRoot = buildStaleRoot();
    const otherSave = buildOtherSave();
    const harness = buildStateHarness(staleRoot, staleRoot);
    enableNarrativeImages(harness.state);
    // 正文生图期间玩家读入另一份存档（真实路径：SaveLoadModal → handleLoadById → replaceGameState）。
    spies.generateImages.mockImplementation(async () => {
      harness.live.current = otherSave;
      return [];
    });

    const result = await resumeCommittedSettlementWorkflow(harness.state, buildJournal(committed));

    expect(spies.generateImages).toHaveBeenCalledTimes(1);
    expect(harness.writes).toHaveLength(0);
    expect(harness.live.current).toBe(otherSave);
    expect(harness.live.current.turnCount).toBe(7);
    expect(harness.live.current.世界.当前地点).toBe('稻妻城');
    expect(spies.saveGame).not.toHaveBeenCalled();
    expect(harness.setHasSave).not.toHaveBeenCalled();
    // 契约更新（修复「守卫命中但 journal 仍被推进」的残留）：
    // 放弃写回时必须**如实上报未完成**。若这里报 ok:true，调用方
    // recoveryResume 就会把 journal 推进到 autosave_committed —— 等于谎报
    // 「自动存档已完成」，下一次恢复会因此跳过该回合的收尾。
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.error : null).toBe('RECOVERY_POST_SETTLEMENT_SUPERSEDED');
    // 更强的一条：journal 的 phase 绝不能被推进到 autosave_committed。
    const persistedPhases = (spies.persist.mock.calls as unknown[][]).map(
      (call) => (call[0] as { phase?: string } | undefined)?.phase,
    );
    expect(persistedPhases).not.toContain('autosave_committed');
  });

  it('still commits and autosaves when the active save never changed', async () => {
    const committed = buildCommittedRoot();
    const staleRoot = buildStaleRoot();
    const harness = buildStateHarness(staleRoot, staleRoot);
    enableNarrativeImages(harness.state);

    const result = await resumeCommittedSettlementWorkflow(harness.state, buildJournal(committed));

    expect(result).toMatchObject({ ok: true, journal: { phase: 'autosave_committed' } });
    expect(harness.writes).toHaveLength(1);
    expect(harness.live.current.turnCount).toBe(3);
    expect(harness.live.current.世界.当前地点).toBe('蒙德城');
    expect(spies.saveGame).toHaveBeenCalledTimes(1);
    const saved = spies.saveGame.mock.calls[0]?.[0];
    expect(saved?.turnCount).toBe(3);
    expect(harness.setHasSave).toHaveBeenCalledWith(true);
  });

  it('still commits when the switched save shares the turn count but not the conversation', async () => {
    const committed = buildCommittedRoot();
    const staleRoot = buildStaleRoot();
    const otherSave = buildOtherSave();
    otherSave.turnCount = staleRoot.turnCount;
    const harness = buildStateHarness(staleRoot, staleRoot);
    enableNarrativeImages(harness.state);
    spies.generateImages.mockImplementation(async () => {
      harness.live.current = otherSave;
      return [];
    });

    await resumeCommittedSettlementWorkflow(harness.state, buildJournal(committed));

    expect(harness.writes).toHaveLength(0);
    expect(harness.live.current).toBe(otherSave);
    expect(spies.saveGame).not.toHaveBeenCalled();
  });
});
