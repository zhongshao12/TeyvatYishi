// @vitest-environment jsdom
import { act, createElement, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTeyvatRuntime, type TeyvatRuntime } from '@/hooks/useTeyvatRuntime';
import { useGame, type UseGameReturn } from '@/hooks/useGame';
import { createLegacyGameViewSelector, toLegacyMemory, applyChatHistoryAction as withLegacyChat, withLegacyMemory, type UseGameStateReturn } from '@/hooks/useGameState';
import { 创建默认游戏设置, 创建空API设置, type API配置项 } from '@/models/settings';
import { 创建空记忆系统 } from '@/models/memory';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import { addImmediateMemory, autoCompressMemorySystemWithArchivesAsync } from '@/hooks/useGame/memoryUtils';
import { clearActiveSaveTreeMetaIfMatches } from '@/hooks/useGame/saveLoadWorkflow';
import type { MemoryRebuildTask } from '@/services/memoryRebuild';
import { isMemoryMaintenanceBusy } from '@/services/memoryMaintenanceRegistry';
import { fingerprintMemoryText } from '@/models/memorySource';

const external = vi.hoisted(() => ({ state: null as unknown, summarize: vi.fn(), save: vi.fn() }));
vi.mock('@/hooks/useGameState', async importActual => ({ ...await importActual<typeof import('@/hooks/useGameState')>(), useGameState: () => external.state }));
vi.mock('@/services/memoryCompression', async importActual => ({ ...await importActual<typeof import('@/services/memoryCompression')>(), summarizeMemoryBatch: external.summarize }));
vi.mock('@/services/dbService', async importActual => ({ ...await importActual<typeof import('@/services/dbService')>(), saveGame: external.save }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const config: API配置项 = { id: 'test', name: 'test', provider: 'openai_compatible', baseUrl: 'https://example.invalid/v1', apiKey: 'test', model: 'test', createdAt: 1, updatedAt: 1 };
let runtime: TeyvatRuntime; let gameApi: UseGameReturn; let hint = ''; let mainController: AbortController;
let root: Root; let host: HTMLDivElement;
let cleanupWork: Array<() => Promise<unknown>>;
let unmounted = false;
const selectGame = createLegacyGameViewSelector();
const toLegacyChat = (game: TeyvatRuntime['game']) => selectGame(game).chatHistory;
function Harness() {
  runtime = useTeyvatRuntime();
  const [workflowHint, setWorkflowHint] = useState(''); hint = workflowHint;
  const controllerRef = useRef(new AbortController()); mainController = controllerRef.current;
  const settings = 创建默认游戏设置();
  settings.记忆系统.短期转中期阈值 = 50; settings.记忆系统.中期转长期阈值 = 50;
  external.state = { ...runtime, chatHistory: toLegacyChat(runtime.game), 记忆: toLegacyMemory(runtime.game), 世界树: runtime.game.世界树,
    turnCount: runtime.game.turnCount, gameSettings: settings, apiSettings: { ...创建空API设置(), activeConfigId: config.id, configs: [config] },
    loading: false, pendingVariable: null, abortControllerRef: controllerRef, setWorkflowHint, setHasSave: () => {},
    set记忆: (memory: Parameters<typeof withLegacyMemory>[1]) => runtime.updateGameState(game => withLegacyMemory(game, memory)),
    set世界树: (tree: typeof runtime.game.世界树) => runtime.updateGameState(game => ({ ...game, 世界树: tree })),
  } as unknown as UseGameStateReturn;
  gameApi = useGame();
  return createElement('div', null, workflowHint);
}
beforeEach(async () => {
  cleanupWork = []; unmounted = false;
  clearActiveSaveTreeMetaIfMatches(); external.save.mockReset().mockResolvedValue(1); external.summarize.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(Harness)));
  await act(async () => runtime.updateGameState(game => withLegacyChat(withLegacyMemory(game, addImmediateMemory(创建空记忆系统(), '旧第1回合', 1)), [
    { id: 'u1', role: 'user', content: '走访蒙德', gameTime: '1', timestamp: 1 },
    { id: 'a1', role: 'assistant', content: '获得信物，约定归还', gameTime: '1', timestamp: 2 },
  ])));
});
afterEach(async () => {
  await act(async () => { for (const finish of cleanupWork) await finish(); });
  if (!unmounted) await act(async () => root.unmount()); host.remove(); clearActiveSaveTreeMetaIfMatches();
});
async function startDelayed() {
  let release!: () => void;
  external.summarize.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ summary: '- 获得信物并约定归还', usedModel: true, usedFallback: false, usedLocal: false }); }));
  let pending!: Promise<MemoryRebuildTask>;
  await act(async () => {
    pending = gameApi.actions.handleBatchMemoryRebuild({ batchSize: 15, range: { start: 1, end: 1 } });
    cleanupWork.push(async () => { release?.(); return pending.catch(() => undefined); });
    await vi.waitFor(() => expect(external.summarize).toHaveBeenCalledTimes(1), { timeout: 10000 });
  });
  return { release, pending };
}

it.each(['load', 'restart', 'reroll', 'delete', 'edit'] as const)('does not submit delayed rebuild results after %s changes its source', async change => {
  const { release, pending } = await startDelayed();
  await act(async () => {
    if (change === 'load' || change === 'restart') runtime.replaceGameState(createEmptyTeyvatGameState());
    else if (change === 'reroll') runtime.updateGameState(game => withLegacyChat(game, toLegacyChat(game).map(m => m.id === 'a1' ? { ...m, id: 'reroll', content: '新正文' } : m)));
    else if (change === 'delete') runtime.updateGameState(game => withLegacyMemory(game, 创建空记忆系统()));
    else runtime.updateGameState(game => withLegacyMemory(game, { ...toLegacyMemory(game), 即时记忆: ['玩家修改'] }));
  });
  const changed = runtime.game;
  await act(async () => { release(); await pending; });
  expect(runtime.game).toBe(changed); expect(external.save).not.toHaveBeenCalled();
});

it('merges unrelated newly added memory and commits archives in the same live update', async () => {
  const { release, pending } = await startDelayed();
  await act(async () => runtime.updateGameState(game => withLegacyMemory(game, addImmediateMemory(toLegacyMemory(game), '新第2回合', 2))));
  await act(async () => { release(); await pending; });
  expect(toLegacyMemory(runtime.game).即时记忆).toEqual(['新第2回合']);
  expect(toLegacyMemory(runtime.game).短期记忆).toEqual(['- 获得信物并约定归还']);
  expect(runtime.game.世界树.entries.some(entry => entry.sourceText.includes('获得信物，约定归还'))).toBe(true);
  expect(external.save.mock.calls[0]?.[0]).toMatchObject({ 记忆: { immediate: ['新第2回合'] }, 世界树: { entries: expect.any(Array) } });
});

it('retains generated sources whose message identities are not reconstructed even if their turn number matches', async () => {
  await act(async () => runtime.updateGameState(game => withLegacyMemory(game, { ...toLegacyMemory(game),
    短期记忆: ['另一段第1回合'], 短期归档ID: ['different-pair'], 来源回合: { ...toLegacyMemory(game).来源回合, 'different-pair': [1] },
    生成文本指纹: { 'different-pair': fingerprintMemoryText('另一段第1回合') },
    来源时刻: { 'different-pair': { start: null, end: null, sourceIds: ['other-user', 'other-assistant'] } },
  })));
  const { release, pending } = await startDelayed(); await act(async () => { release(); await pending; });
  expect(toLegacyMemory(runtime.game).短期记忆).toEqual(['另一段第1回合', '- 获得信物并约定归还']);
});

it('does not replace a source when two distinct player pairs share its turn number', async () => {
  await act(async () => runtime.updateGameState(game => withLegacyChat(game, [ ...toLegacyChat(game),
    { id: 'u-second', role: 'user', content: '另一段输入', gameTime: '1', timestamp: 3 },
    { id: 'a-second', role: 'assistant', content: '另一段正文', gameTime: '1', timestamp: 4 },
  ])));
  external.summarize.mockResolvedValue({ summary: '- 错配摘要', usedModel: true });
  await act(async () => gameApi.actions.handleBatchMemoryRebuild({ batchSize: 15 }));
  expect(toLegacyMemory(runtime.game).即时记忆).toEqual(['旧第1回合']);
  expect(external.summarize).not.toHaveBeenCalled(); expect(external.save).not.toHaveBeenCalled();
});

it('starts only one model request for overlapping maintenance and never aborts the main-turn controller', async () => {
  const originalMainController = mainController;
  const { release, pending } = await startDelayed();
  const aborted = mainController.signal.aborted;
  let second!: MemoryRebuildTask;
  await act(async () => { second = await gameApi.actions.handleBatchMemoryRebuild({ batchSize: 15 }); });
  expect(external.summarize).toHaveBeenCalledTimes(1); expect(second.status).toBe('blocked');
  expect(mainController.signal.aborted).toBe(aborted); expect(aborted).toBe(false);
  expect(originalMainController.signal.aborted).toBe(false);
  await act(async () => { release(); await pending; });
});

it('cancels only maintenance and ignores a late successful result', async () => {
  const originalMainController = mainController; const { release, pending } = await startDelayed();
  await act(async () => gameApi.actions.handleCancelMemoryMaintenance());
  expect(isMemoryMaintenanceBusy(runtime.getGameSessionId())).toBe(false);
  const before = runtime.game;
  let task!: MemoryRebuildTask;
  await act(async () => { release(); task = await pending; });
  expect(task.status).toBe('cancelled'); expect(runtime.game).toBe(before);
  expect(originalMainController.signal.aborted).toBe(false); expect(external.save).not.toHaveBeenCalled();
});

it('publishes live task progress and cancellation to the UI without using the main controller', async () => {
  const { release, pending } = await startDelayed();
  expect(gameApi.maintenance?.busy).toBe(true); expect(gameApi.maintenance?.progress?.phase).toBe('turns');
  await act(async () => gameApi.actions.handleCancelMemoryMaintenance());
  expect(gameApi.maintenance?.busy).toBe(false); expect(gameApi.maintenance?.status).toContain('取消');
  await act(async () => { release(); await pending; });
});

it('rejects a switch performed after the final model result but before commit', async () => {
  external.summarize.mockResolvedValue({ summary: '- 成功摘要', usedModel: true });
  let switched = false; let task!: MemoryRebuildTask;
  await act(async () => {
    task = await gameApi.actions.handleBatchMemoryRebuild({ batchSize: 15, onProgress: progress => {
      if (!switched && progress.processedTurns === 1) { switched = true; runtime.replaceGameState(createEmptyTeyvatGameState()); }
    } });
  });
  expect(task.status).toBe('cancelled'); expect(external.save).not.toHaveBeenCalled();
  expect(toLegacyMemory(runtime.game).短期记忆).toEqual([]);
});

it('resumes a failed rebuild in its original session and resolves only its own failure record', async () => {
  await act(async () => runtime.updateGameState(game => withLegacyChat(withLegacyMemory(game, addImmediateMemory(toLegacyMemory(game), '旧第2回合', 2)), [
    ...toLegacyChat(game), { id: 'u2', role: 'user', content: '继续', gameTime: '2', timestamp: 3 },
    { id: 'a2', role: 'assistant', content: '完成约定', gameTime: '2', timestamp: 4 },
  ])));
  let failed = false; const calls: number[] = [];
  external.summarize.mockImplementation(async (source: { turn: number }) => {
    calls.push(source.turn);
    if (source.turn === 2 && !failed) { failed = true; return { summary: 'fallback', usedFallback: true, failureCode: 'request_failed', failureMessage: '503' }; }
    return { summary: `摘要${source.turn}`, usedFallback: false, usedModel: true };
  });
  let task!: MemoryRebuildTask;
  await act(async () => { task = await gameApi.actions.handleBatchMemoryRebuild({ batchSize: 15 }); });
  expect(task.status).toBe('paused_failed'); expect(toLegacyMemory(runtime.game).即时记忆).toEqual(['旧第1回合', '旧第2回合']);
  expect(toLegacyMemory(runtime.game).失败草稿?.[0]?.status).toBe('pending');
  await act(async () => { task = await gameApi.actions.handleBatchMemoryRebuild({ batchSize: 15, task }); });
  expect(task.blockedReason).toBeUndefined(); expect(task.status).toBe('committed'); expect(calls).toEqual([1, 2, 2]);
  expect(toLegacyMemory(runtime.game).失败草稿?.[0]?.status).toBe('resolved');
  expect(toLegacyMemory(runtime.game).短期记忆).toEqual(['摘要1', '摘要2']);
});

it('rebuilds again while preserving player-edited summaries and original archive anchors', async () => {
  const first = await startDelayed();
  await act(async () => { first.release(); await first.pending; });
  await act(async () => runtime.updateGameState(game => ({ ...withLegacyMemory(game, { ...toLegacyMemory(game), 短期记忆: ['玩家笔记'] }),
    世界树: { entries: game.世界树.entries.map(entry => entry.archiveType === 'refined' ? { ...entry, sourceText: '玩家编辑原档', summary: '玩家编辑原档' } : entry) } })));
  const edited = runtime.game.世界树.entries.find(entry => entry.archiveType === 'refined')!;
  external.summarize.mockClear(); const second = await startDelayed();
  await act(async () => { second.release(); await second.pending; });
  expect(toLegacyMemory(runtime.game).短期记忆).toEqual(['玩家笔记', '- 获得信物并约定归还']);
  expect(runtime.game.世界树.entries.find(entry => entry.id === edited.id)).toEqual(edited);
});

it('keeps an applied-but-unsaved result and retries persistence without another model request', async () => {
  const { release, pending } = await startDelayed(); external.save.mockRejectedValueOnce(new Error('disk full'));
  let task!: MemoryRebuildTask;
  await act(async () => { release(); task = await pending.catch(() => undefined) as MemoryRebuildTask; });
  expect(toLegacyMemory(runtime.game).短期记忆).toHaveLength(1);
  expect(hint).toMatch(/页面.*更新.*保存失败/); expect(hint).not.toContain('重建完成');
  expect(task).toBeDefined();
  await act(async () => { await gameApi.actions.handleBatchMemoryRebuild({ batchSize: 15, task }); });
  expect(external.summarize).toHaveBeenCalledTimes(1); expect(external.save).toHaveBeenCalledTimes(2);
  expect(hint).toMatch(/保存/);
});

it('does not write a late model result after the hook unmounts', async () => {
  const { release, pending } = await startDelayed();
  await act(async () => root.unmount()); unmounted = true;
  release(); const task = await pending;
  expect(task.status).toBe('cancelled'); expect(external.save).not.toHaveBeenCalled();
  expect(isMemoryMaintenanceBusy(runtime.getGameSessionId())).toBe(false);
});

it('uses the live coordinator to retry a retained failed source and save both layers atomically', async () => {
  external.summarize.mockResolvedValueOnce({ summary: 'fallback', usedFallback: true, failureCode: 'request_failed', failureMessage: '503' });
  const s = external.state as UseGameStateReturn;
  const failed = await autoCompressMemorySystemWithArchivesAsync(s.记忆, 1, { ...s.gameSettings.记忆系统, 即时转短期阈值: 1 }, config);
  await act(async () => runtime.updateGameState(game => ({ ...withLegacyMemory(game, failed.memory), 世界树: { entries: failed.archives } })));
  external.summarize.mockReset().mockResolvedValue({ summary: '- 重试成功', usedFallback: false, usedModel: true });
  await act(async () => gameApi.actions.handleRetryMemoryFailureDraft(failed.failures[0]!.id));
  expect(toLegacyMemory(runtime.game).即时记忆).toEqual([]);
  expect(toLegacyMemory(runtime.game).短期记忆).toEqual(['- 重试成功']);
  expect(toLegacyMemory(runtime.game).失败草稿?.[0]?.status).toBe('resolved');
  expect(runtime.game.世界树.entries.some(entry => entry.status === 'pending')).toBe(false);
  expect(external.save.mock.calls[0]?.[0]).toMatchObject({ 记忆: { shortTerm: ['- 重试成功'] }, 世界树: { entries: expect.any(Array) } });
});
