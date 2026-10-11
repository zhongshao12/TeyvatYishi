import { flushSync } from 'react-dom';
import type { UseGameReturn } from '@/hooks/useGame';
import { createLegacyGameViewSelector, readLiveGameState, toLegacyMemory, withLegacyMemory, type UseGameStateReturn } from '@/hooks/useGameState';
import type { API配置项 } from '@/models/settings';
import { serializeMemoryFailureSource, type 记忆失败草稿 } from '@/models/memory';
import { fingerprintMemoryText, memorySourceValuesEqual as same, type MemoryMaintenanceState, type MemoryMaintenancePatch, type MemorySourceLayer } from '@/models/memorySource';
import { createMemoryRebuildTask, runMemoryRebuildTask, cancelMemoryRebuildTask, type MemoryRebuildTask } from '@/services/memoryRebuild';
import { ensureMemorySourceIdentities, readMemoryLayerThresholds, runMemoryLayerCompression } from '@/services/memoryLayerCompression';
import { mergeMemoryMaintenancePatch, prepareMemoryRebuildScope } from '@/services/memoryMaintenanceMerge';
import { readMemorySourceItems } from '@/services/memorySources';
import { summarizeMemoryBatch } from '@/services/memoryCompression';
import { retryMemoryFailureDraft } from './memoryUtils';
import { tryAcquireMemoryMaintenanceLease, type MemoryMaintenanceLease } from '@/services/memoryMaintenanceRegistry';
import { getActiveSaveTreeIdentity } from './saveLoadWorkflow';
import { persistMemorySnapshot } from './memorySaveTask';
import type { TeyvatGameState } from '@/models/teyvat';

type RebuildOptions = Parameters<UseGameReturn['actions']['handleBatchMemoryRebuild']>[0];
interface Binding { sessionId: number; rootId: string | null; base: MemoryMaintenanceState; task?: MemoryRebuildTask; failureIds: Set<string> }
const selectGame = createLegacyGameViewSelector();
const memoryState = (game: TeyvatGameState): MemoryMaintenanceState => ({ memory: toLegacyMemory(game), irminsul: game.世界树 });
const emptyPatch = (): MemoryMaintenancePatch => ({ removed: [], added: [], archiveUpserts: [], archiveRemoved: [], failureUpserts: [] });

export function createMemoryMaintenanceCoordinator(deps: { getState: () => UseGameStateReturn; getConfig: () => API配置项 | null }) {
  const bindings = new WeakMap<MemoryRebuildTask, Binding>();
  let activeLease: MemoryMaintenanceLease | null = null; let lastTask: MemoryRebuildTask | undefined; let disposed = false;
  const current = (binding: Binding, lease?: MemoryMaintenanceLease): boolean => {
    if (disposed || lease?.signal.aborted || deps.getState().getGameSessionId() !== binding.sessionId) return false;
    const root = getActiveSaveTreeIdentity()?.rootId ?? null;
    if (binding.rootId === null && root !== null) binding.rootId = root; // same session's first save
    return binding.rootId === root;
  };
  const feedback = (binding: Binding, text: string, lease?: MemoryMaintenanceLease) => { if (current(binding, lease)) { deps.getState().setWorkflowHint(text); lease?.report(null, text); } };
  const acquire = (binding: Binding) => {
    const lease = tryAcquireMemoryMaintenanceLease(binding.sessionId, binding.rootId);
    if (lease) activeLease = lease;
    return lease;
  };
  const release = (lease: MemoryMaintenanceLease) => { lease.release(); if (activeLease === lease) activeLease = null; };
  const begin = (): Binding => {
    const state = deps.getState();
    return { sessionId: state.getGameSessionId(), rootId: getActiveSaveTreeIdentity()?.rootId ?? null,
      base: structuredClone(memoryState(readLiveGameState(state))), failureIds: new Set() };
  };
  const bindIdentities = (binding: Binding) => {
    flushSync(() => deps.getState().updateGameState(game => {
      if (!current(binding)) return game;
      const state = ensureMemorySourceIdentities(memoryState(game));
      return same(state.memory, toLegacyMemory(game)) ? game : withLegacyMemory(game, state.memory);
    }));
    binding.base = structuredClone(memoryState(readLiveGameState(deps.getState())));
  };
  const sourcesUnchanged = (binding: Binding, game: TeyvatGameState): boolean => {
    if (!binding.task) return true;
    const task = binding.task;
    const liveState = memoryState(game);
    const liveTask = createMemoryRebuildTask({ sourceState: liveState, chatHistory: selectGame(game).chatHistory, batchSize: task.batchSize, range: task.range });
    if (!same(liveTask.turns, task.turns)) return false;
    const liveItems = readMemorySourceItems(liveState);
    const scope = task.rebuildScope ?? prepareMemoryRebuildScope(binding.base, task.range);
    return scope.replaceable.every(item => same(item, liveItems.find(live => live.id === item.id)))
      && scope.replaceable.every(item => [item.id!, ...item.sourceEntryIds].every(id => same(binding.base.irminsul.entries.filter(entry => entry.id === id), liveState.irminsul.entries.filter(entry => entry.id === id))));
  };
  const commit = (binding: Binding, lease: MemoryMaintenanceLease, patch: MemoryMaintenancePatch): MemoryMaintenanceState => {
    let committed: MemoryMaintenanceState | undefined;
    flushSync(() => deps.getState().updateGameState(game => {
      if (!current(binding, lease) || !sourcesUnchanged(binding, game)) return game;
      const result = mergeMemoryMaintenancePatch(binding.base, memoryState(game), patch);
      if (!result.ok) return game;
      committed = result.state;
      return { ...withLegacyMemory(game, result.state.memory), 世界树: result.state.irminsul };
    }));
    if (!committed) throw new Error('来源已变化、存档已切换或整理已取消，原记忆保持不变。');
    return committed;
  };
  const save = async (binding: Binding, lease: MemoryMaintenanceLease, task?: MemoryRebuildTask): Promise<boolean> => {
    if (!current(binding, lease)) return false;
    const live = readLiveGameState(deps.getState()); if (!current(binding, lease)) return false;
    if (task) { task.persistence = 'pending'; task.progress.phase = 'saving'; }
    lease.report({ phase: 'saving', processedTurns: task?.progress.processedTurns ?? 0, totalTurns: task?.progress.totalTurns ?? 0, currentTurn: null }, '正在保存整理结果…');
    try {
      await persistMemorySnapshot(deps.getState(), toLegacyMemory(live), live.世界树,
        { expectedSessionId: binding.sessionId, expectedRootId: binding.rootId, signal: lease.signal });
      if (!current(binding, lease)) return false;
      if (task) task.persistence = 'saved';
      return true;
    } catch (error) {
      if (current(binding, lease)) {
        if (task) task.persistence = 'failed';
        feedback(binding, `记忆已在当前页面更新，但保存失败：${error instanceof Error ? error.message : '未知错误'}；可只重试保存。`, lease);
      }
      return false;
    }
  };
  const rebuildPatch = (binding: Binding, task: MemoryRebuildTask): MemoryMaintenancePatch => {
    const recoverable = new Set(task.turns.map(turn => turn.turn));
    const reconstructedMessages = new Set(task.turns.flatMap(turn => turn.sourceMessageIds));
    const entryIds = new Set([...readMemorySourceItems(binding.base).flatMap(item => item.id ? [item.id] : []), ...binding.base.irminsul.entries.map(entry => entry.id)]);
    const removed = (task.rebuildScope?.replaceable ?? []).filter(item => item.sourceTurns.every(turn => recoverable.has(turn))
      && item.sourceMessageIds.filter(id => !entryIds.has(id)).every(id => reconstructedMessages.has(id)));
    const items = readMemorySourceItems({ memory: task.staging, irminsul: task.stagedIrminsul });
    const removedIds = new Set(removed.map(item => item.id));
    const originalArrayIds = new Set([...(binding.base.memory.即时记忆ID ?? []), ...(binding.base.memory.短期归档ID ?? []),
      ...(binding.base.memory.中期归档ID ?? []), ...(binding.base.memory.长期归档ID ?? [])]);
    const used = new Set([...originalArrayIds, ...binding.base.irminsul.entries.map(entry => entry.id), ...task.stagedIrminsul.entries.map(entry => entry.id)]);
    const renamed = new Map<string, string>();
    const rename = (id: string) => {
      if (renamed.has(id)) return;
      const prefix = `${id}_${task.id}`; let alias = prefix; let index = 0;
      while (used.has(alias)) alias = `${prefix}_${++index}`;
      used.add(alias); renamed.set(id, alias);
    };
    for (const item of items) if (item.id && originalArrayIds.has(item.id) && !removedIds.has(item.id)) rename(item.id);
    const equivalent = (a: typeof task.stagedIrminsul.entries[number], b: typeof a) => same({ ...a, recordedAt: '' }, { ...b, recordedAt: '' });
    for (const entry of task.stagedIrminsul.entries) {
      const previous = binding.base.irminsul.entries.filter(old => old.id === entry.id);
      if (previous.length && !removedIds.has(entry.id) && (previous.length !== 1 || !equivalent(previous[0]!, entry))) rename(entry.id);
    }
    const mapId = (id: string) => renamed.get(id) ?? id;
    const added = items.map(item => ({ ...item, id: item.id ? mapId(item.id) : null, sourceEntryIds: item.sourceEntryIds.map(mapId) }));
    const archives = task.stagedIrminsul.entries.map(entry => ({ ...entry, id: mapId(entry.id),
      ...(entry.coveredEntryIds ? { coveredEntryIds: entry.coveredEntryIds.map(mapId) } : {}) }));
    return { ...emptyPatch(), removed, added,
      archiveUpserts: archives.filter(entry => !binding.base.irminsul.entries.some(previous => previous.id === entry.id && equivalent(previous, entry))),
      archiveSources: binding.base.irminsul.entries.filter(entry => removed.some(item => item.id === entry.id || item.sourceEntryIds.includes(entry.id))),
      failureUpserts: (binding.base.memory.失败草稿 ?? []).filter(draft => binding.failureIds.has(draft.id)).map(draft => ({ ...draft,
        status: 'resolved', sourceSnapshot: { ...draft.sourceSnapshot, payload: '' }, updatedAt: Date.now() })) };
  };
  const runRebuild = async (options: RebuildOptions): Promise<MemoryRebuildTask> => {
    const previous = options.task ? bindings.get(options.task) : undefined;
    const binding = previous ?? begin();
    const task = options.task ?? createMemoryRebuildTask({ chatHistory: selectGame(readLiveGameState(deps.getState())).chatHistory,
      sourceState: binding.base, batchSize: options.batchSize, range: options.range });
    if (options.task && !previous) { task.status = 'blocked'; task.blockedReason = '旧任务没有当前会话身份，请重新创建重建任务。'; return task; }
    if (!current(binding)) { task.status = 'cancelled'; return task; }
    const lease = acquire(binding);
    if (!lease) { if (task.status !== 'running') { task.status = 'blocked'; task.blockedReason = '本存档已有记忆整理任务，请等待或取消当前任务。'; } return task; }
    try {
      if (task.status === 'committed') {
        if (task.persistence === 'failed' && await save(binding, lease, task)) feedback(binding, '重建结果已重新保存；未重复调用模型。', lease);
        return task;
      }
      if (!previous) { bindIdentities(binding); task.rebuildScope = prepareMemoryRebuildScope(binding.base, task.range); binding.task = task; bindings.set(task, binding); }
      lastTask = task;
      if (!sourcesUnchanged(binding, readLiveGameState(deps.getState()))) { task.status = 'blocked'; task.blockedReason = '重建来源已变化，请创建新任务。'; return task; }
      const settings = structuredClone(deps.getState().gameSettings.记忆系统); const config = deps.getConfig();
      if (!config || settings.启用中短长期API总结 === false) { task.status = 'blocked'; task.blockedReason = !config ? '请先配置主 API 或记忆总结 API。' : '请先开启中短长期 API 总结。'; feedback(binding, task.blockedReason, lease); return task; }
      feedback(binding, `正在逐回合重建 ${task.turns.length} 个完整回合，全部成功后合并所选来源。`, lease);
      await runMemoryRebuildTask(task, { settings: { apiEnabled: true, thresholds: readMemoryLayerThresholds(settings),
        prompts: { short: settings.即时转短期提示词, middle: settings.短期转中期提示词, long: settings.中期转长期提示词 || settings.短期转长期提示词 } },
        signal: lease.signal, onProgress: progress => {
          if (!current(binding, lease)) { lease.cancel(); return; }
          lease.report({ phase: progress.phase ?? 'turns', processedTurns: progress.processedTurns, totalTurns: progress.totalTurns, currentTurn: progress.currentTurn ?? null });
          options.onProgress?.(progress); if (!current(binding, lease)) lease.cancel();
        }, summarizer: (source, context) => summarizeMemoryBatch(source, settings, config, context.signal, settings.记忆总结API.retryCount ?? 2) });
      if (!current(binding, lease)) { cancelMemoryRebuildTask(task); return task; }
      if (task.status === 'ready') {
        commit(binding, lease, rebuildPatch(binding, task)); task.status = 'committed';
        if (await save(binding, lease, task)) feedback(binding, `逐回合重建已合并并保存；共 ${task.progress.processedTurns} 个完整回合，保留范围外及受保护资料。`, lease);
      } else if (task.status === 'paused_failed' && task.failedBatch) {
        const failed = task.failedBatch; const sourceSnapshot = await serializeMemoryFailureSource(failed.items);
        if (!current(binding, lease)) { cancelMemoryRebuildTask(task); return task; }
        const id = `memory_rebuild_failure_${task.id}_${failed.kind}_${sourceSnapshot.checksum}`;
        const existing = binding.base.memory.失败草稿?.find(draft => draft.id === id); const now = Date.now();
        const draft: 记忆失败草稿 = { id, origin: 'batch_rebuild', kind: failed.kind, status: 'pending', sourceTurns: failed.sourceTurns, sourceSnapshot,
          targetLayer: failed.kind === 'short' ? '短期记忆' : failed.kind === 'middle' ? '中期记忆' : '长期记忆',
          fallbackSummary: failed.fallbackSummary, failureCode: failed.code === 'empty_output' || failed.code === 'unconfigured' || failed.code === 'source_changed' ? failed.code : 'request_failed',
          failureMessage: failed.message, attemptCount: failed.attemptCount, createdAt: existing?.createdAt ?? now, updatedAt: now };
        commit(binding, lease, { ...emptyPatch(), failureUpserts: [draft] }); binding.failureIds.add(id);
        binding.base.memory.失败草稿 = structuredClone(toLegacyMemory(readLiveGameState(deps.getState())).失败草稿);
        if (await save(binding, lease, task)) feedback(binding, `重建在第 ${failed.sourceTurns.start}-${failed.sourceTurns.end} 回合暂停；原记忆未覆盖，失败材料已保存。`, lease);
      }
      return task;
    } catch (error) {
      if (!current(binding, lease)) cancelMemoryRebuildTask(task);
      else { task.status = 'blocked'; task.blockedReason = error instanceof Error ? error.message : '记忆整理失败。'; feedback(binding, task.blockedReason, lease); }
      return task;
    } finally { release(lease); }
  };

  const compress = async (mode: 'manual' | 'irminsul', layer?: MemorySourceLayer): Promise<void> => {
    const binding = begin(); const lease = acquire(binding);
    if (!lease) { feedback(binding, '本存档已有记忆整理任务。'); return; }
    try {
      bindIdentities(binding); const settings = structuredClone(deps.getState().gameSettings.记忆系统); const config = deps.getConfig();
      if (settings.启用中短长期API总结 !== false && !config) { feedback(binding, '请先配置记忆总结 API。', lease); return; }
      const result = await runMemoryLayerCompression({ state: binding.base, turn: readLiveGameState(deps.getState()).turnCount, settings, mode,
        onProgress: progress => { if (current(binding, lease)) lease.report(progress); else lease.cancel(); },
        signal: lease.signal, ...(layer ? { sourceIds: readMemorySourceItems(binding.base).filter(item => item.layer === layer && item.id).map(item => item.id!) } : {}),
        summarizer: (source, context) => summarizeMemoryBatch(source, settings, config!, context.signal, settings.记忆总结API.retryCount ?? 2) });
      if (!current(binding, lease)) return;
      if (!result.patch.removed.length && !result.patch.archiveUpserts.length && !result.patch.failureUpserts.length) { feedback(binding, result.blockedReason ?? '未达阈值，无需整理。', lease); return; }
      commit(binding, lease, result.patch);
      if (await save(binding, lease)) feedback(binding, result.failures.length ? '模型总结失败，原层来源及失败材料已保存。' : `${result.usedLocal ? '本地' : '模型'}整理已保存；无法验证覆盖的原文仍保留。`, lease);
    } catch (error) { feedback(binding, error instanceof Error ? error.message : '整理失败。', lease); }
    finally { release(lease); }
  };
  const retryDraft = async (id: string): Promise<void> => {
    const binding = begin(); const lease = acquire(binding); if (!lease) { feedback(binding, '本存档已有记忆整理任务。'); return; }
    try {
      const settings = structuredClone(deps.getState().gameSettings.记忆系统); const config = deps.getConfig();
      if (!config) { feedback(binding, '请先配置记忆总结 API。', lease); return; }
      const result = await retryMemoryFailureDraft(binding.base.memory, id, settings, config, lease.signal, binding.base.irminsul);
      if (!current(binding, lease)) return;
      const before = readMemorySourceItems(binding.base); const after = readMemorySourceItems({ memory: result.memory, irminsul: result.irminsul ?? binding.base.irminsul });
      const draft = binding.base.memory.失败草稿?.find(item => item.id === id);
      const inputIds = new Set([...(draft?.sourceIds ?? []), ...(draft?.archiveEntryId ? [draft.archiveEntryId] : [])]);
      const patch: MemoryMaintenancePatch = { removed: before.filter(item => !after.some(next => same(item, next))), added: after.filter(item => !before.some(previous => same(item, previous))),
        sourceReads: before.filter(item => item.id && inputIds.has(item.id)),
        archiveRemoved: binding.base.irminsul.entries.filter(entry => !result.irminsul?.entries.some(next => next.id === entry.id)),
        archiveUpserts: (result.irminsul?.entries ?? []).filter(entry => !binding.base.irminsul.entries.some(previous => same(entry, previous))),
        archiveSources: binding.base.irminsul.entries.filter(entry => inputIds.has(entry.id)), failureUpserts: [result.draft] };
      commit(binding, lease, patch);
      if (await save(binding, lease)) feedback(binding, result.draft.status === 'resolved' ? '失败来源已重新总结并保存。' : `重试仍未成功：${result.draft.failureMessage}`, lease);
    } catch (error) { feedback(binding, error instanceof Error ? error.message : '重试失败。', lease); }
    finally { release(lease); }
  };
  const ignoreDraft = async (id: string): Promise<void> => {
    const binding = begin(); const lease = acquire(binding); if (!lease) { feedback(binding, '本存档已有记忆整理任务。'); return; }
    try {
      const draft = binding.base.memory.失败草稿?.find(item => item.id === id); if (!draft) return;
      commit(binding, lease, { ...emptyPatch(), failureUpserts: [{ ...draft, status: 'ignored', sourceSnapshot: { ...draft.sourceSnapshot, payload: '' }, updatedAt: Date.now() }] });
      if (await save(binding, lease)) feedback(binding, '失败草稿已忽略并保存；原始来源仍保留。', lease);
    } catch (error) { feedback(binding, error instanceof Error ? error.message : '忽略草稿失败。', lease); }
    finally { release(lease); }
  };
  const cancel = () => { const lease = activeLease; lease?.cancel(); lease?.release(); activeLease = null; if (lastTask) cancelMemoryRebuildTask(lastTask); };
  return { runRebuild, compress, retryDraft, ignoreDraft, cancel, dispose: () => { cancel(); disposed = true; } };
}
