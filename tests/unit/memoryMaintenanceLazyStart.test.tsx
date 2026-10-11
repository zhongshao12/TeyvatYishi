// @vitest-environment jsdom
import { act, createElement, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useGame, type UseGameReturn } from '@/hooks/useGame';
import { useTeyvatRuntime, type TeyvatRuntime } from '@/hooks/useTeyvatRuntime';
import { createLegacyGameViewSelector, toLegacyMemory, withLegacyMemory, applyChatHistoryAction, type UseGameStateReturn } from '@/hooks/useGameState';
import { 创建默认游戏设置, 创建空API设置, type API配置项 } from '@/models/settings';
import { 创建空记忆系统, serializeMemoryFailureSource, type 记忆失败草稿 } from '@/models/memory';
import { addImmediateMemory } from '@/hooks/useGame/memoryUtils';
import { buildSavePayload, commitActiveSaveTreeMeta, clearActiveSaveTreeMetaIfMatches } from '@/hooks/useGame/saveLoadWorkflow';
import { getMemoryMaintenanceSnapshot, subscribeMemoryMaintenance } from '@/services/memoryMaintenanceRegistry';

const external = vi.hoisted(() => ({ state: null as unknown, summarize: vi.fn(), save: vi.fn() }));
vi.mock('@/hooks/useGameState', async original => ({ ...await original<typeof import('@/hooks/useGameState')>(), useGameState: () => external.state }));
vi.mock('@/services/memoryCompression', async original => ({ ...await original<typeof import('@/services/memoryCompression')>(), summarizeMemoryBatch: external.summarize }));
vi.mock('@/services/dbService', async original => ({ ...await original<typeof import('@/services/dbService')>(), saveGame: external.save }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const config: API配置项 = { id: 'test', name: 'test', provider: 'openai_compatible', baseUrl: 'https://example.invalid/v1', apiKey: 'test', model: 'test', createdAt: 1, updatedAt: 1 };
const select = createLegacyGameViewSelector();
let root: Root; let host: HTMLDivElement; let runtime: TeyvatRuntime; let api: UseGameReturn;
let release: () => void; let importStarted: Promise<void>; let pending: Promise<unknown> | undefined;
function Harness() {
  runtime = useTeyvatRuntime(); const [, setWorkflowHint] = useState(''); const abortControllerRef = useRef(new AbortController());
  const gameSettings = 创建默认游戏设置(); gameSettings.记忆系统.即时转短期阈值 = 1;
  external.state = { ...runtime, chatHistory: select(runtime.game).chatHistory, 记忆: toLegacyMemory(runtime.game), 世界树: runtime.game.世界树,
    turnCount: runtime.game.turnCount, gameSettings, apiSettings: { ...创建空API设置(), configs: [config], activeConfigId: config.id },
    abortControllerRef, setWorkflowHint, setHasSave: () => {},
  } as unknown as UseGameStateReturn;
  api = useGame(); return null;
}
beforeEach(async () => {
  pending = undefined; clearActiveSaveTreeMetaIfMatches();
  external.save.mockReset().mockResolvedValue(1); external.summarize.mockReset().mockResolvedValue({ summary: '- 摘要', usedModel: true });
  let started!: () => void; importStarted = new Promise(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.doMock('@/hooks/useGame/memoryMaintenanceStage', async original => { started(); await gate; return await original(); });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(Harness)));
  const memory = addImmediateMemory(创建空记忆系统(), '原始来源', 1);
  const draft: 记忆失败草稿 = { id: 'shared-draft', kind: 'short', status: 'pending', sourceIds: [memory.即时记忆ID![0]!], sourceTurns: { start: 1, end: 1 },
    sourceSnapshot: await serializeMemoryFailureSource(['原始来源']), targetLayer: '短期记忆', fallbackSummary: 'fallback', failureCode: 'request_failed', failureMessage: '503', attemptCount: 1, createdAt: 1, updatedAt: 1 };
  await act(async () => runtime.updateGameState(game => applyChatHistoryAction(withLegacyMemory(game, { ...memory, 失败草稿: [draft] }), [
    { id: 'u1', role: 'user', content: '输入', gameTime: '1', timestamp: 1 },
    { id: 'a1', role: 'assistant', content: '正文', gameTime: '1', timestamp: 2 },
  ])));
});
afterEach(async () => {
  release(); await act(async () => { await pending?.catch(() => {}); root.unmount(); });
  host.remove(); clearActiveSaveTreeMetaIfMatches(); vi.doUnmock('@/hooks/useGame/memoryMaintenanceStage');
});
function invoke(action: string) {
  if (action === 'ignore') return api.actions.handleIgnoreMemoryFailureDraft('shared-draft');
  if (action === 'retry') return api.actions.handleRetryMemoryFailureDraft('shared-draft');
  if (action === 'compress') return api.actions.handleCompressMemory('immediate');
  return api.actions.handleBatchMemoryRebuild({ batchSize: 15 });
}
it.each(['rebuild', 'compress', 'retry', 'ignore'])('does not start %s in a new session while its lazy module is loading', async action => {
  pending = invoke(action).catch(error => error); await importStarted;
  await act(async () => runtime.replaceGameState(structuredClone(runtime.game)));
  const next = runtime.game;
  const busy: boolean[] = []; const unsubscribe = subscribeMemoryMaintenance(() => busy.push(getMemoryMaintenanceSnapshot(runtime.getGameSessionId()).busy));
  await act(async () => { release(); await pending; });
  unsubscribe(); expect(busy).not.toContain(true);
  expect(runtime.game).toBe(next); expect(toLegacyMemory(runtime.game).失败草稿?.[0]?.status).toBe('pending');
  expect(external.summarize).not.toHaveBeenCalled(); expect(external.save).not.toHaveBeenCalled();
});
it.each(['rebuild', 'ignore'])('cancels a queued %s before lazy loading has completed', async action => {
  pending = invoke(action).catch(error => error); await importStarted; const current = runtime.game;
  await act(async () => api.actions.handleCancelMemoryMaintenance());
  await act(async () => { release(); await pending; });
  expect(runtime.game).toBe(current); expect(external.summarize).not.toHaveBeenCalled(); expect(external.save).not.toHaveBeenCalled();
});

it('does not start in a different root even when the runtime session alias is unchanged', async () => {
  commitActiveSaveTreeMeta(buildSavePayload(external.state as UseGameStateReturn, 'auto', {}, runtime.game));
  pending = invoke('ignore').catch(error => error); await importStarted;
  clearActiveSaveTreeMetaIfMatches();
  commitActiveSaveTreeMeta(buildSavePayload(external.state as UseGameStateReturn, 'auto', {}, runtime.game));
  const current = runtime.game;
  await act(async () => { release(); await pending; });
  expect(runtime.game).toBe(current); expect(external.save).not.toHaveBeenCalled();
});
