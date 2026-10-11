import type { 聊天消息 } from '@/models/chat';
import { MEMORY_LAYER_COMPRESSION_THRESHOLD, 创建空记忆系统, deserializeMemoryFailureSource, type 记忆系统 } from '@/models/memory';
import type { MemoryCompressionSource } from '@/services/memoryCompression';
import { narrativeTurnBodyText } from '@/models/teyvat/narrativeTurn';
import { fingerprintMemoryText, type MemoryMaintenanceState, type MemorySourceItem, type MemoryLayerThresholds } from '@/models/memorySource';
import type { IrminsulMemory, IrminsulEntry } from '@/models/teyvat/irminsul';
import { resolveRebuildTurnMoment, readMemorySourceItems } from './memorySources';
import type { WorldMomentRange } from '@/models/teyvat/worldMoment';
import { 创建默认记忆系统设置 } from '@/models/settings';
import { runMemoryLayerCompression } from './memoryLayerCompression';
import { prepareMemoryRebuildScope } from './memoryMaintenanceMerge';

/** A completed story turn used by batch memory rebuilding. */
export interface MemoryRebuildTurn {
  turn: number;
  userId: string;
  assistantId: string;
  userInput: string;
  body: string;
  sourceMessageIds: string[];
  momentRange: WorldMomentRange;
}

export interface MemoryRebuildRange {
  start?: number;
  end?: number;
}

export interface MemoryRebuildPrompts {
  short?: string;
  middle?: string;
  long?: string;
}

/**
 * The service deliberately accepts a narrow settings shape. The caller can pass
 * the real settings object without making this recovery module depend on UI or
 * the settings model's migration details.
 */
export interface MemoryRebuildSettings {
  apiEnabled?: boolean;
  prompts?: MemoryRebuildPrompts;
  compressionThreshold?: number;
  thresholds?: MemoryLayerThresholds;
}

export interface MemoryRebuildSummarySuccess {
  ok: true;
  summary: string;
}

export interface MemoryRebuildSummaryFailure {
  ok: false;
  fallback?: string;
  code?: string;
  message?: string;
}

export type MemoryRebuildSummaryResult =
  | MemoryRebuildSummarySuccess
  | MemoryRebuildSummaryFailure
  // Kept for compatibility with the current memoryCompression result while
  // that service is migrated to the discriminated result above.
  | {
    summary: string;
    usedFallback?: boolean;
    usedLocal?: boolean;
    code?: string;
    message?: string;
    failureCode?: string;
    failureMessage?: string;
  };

export interface MemoryRebuildSummarizerContext {
  settings: MemoryRebuildSettings;
  signal?: AbortSignal;
}

export type MemoryRebuildSummarizer = (
  source: MemoryCompressionSource,
  context: MemoryRebuildSummarizerContext,
) => Promise<MemoryRebuildSummaryResult>;

export type MemoryRebuildTaskStatus =
  | 'idle'
  | 'running'
  | 'paused_failed'
  | 'blocked'
  | 'ready'
  | 'committed'
  | 'cancelled';

export interface MemoryRebuildProgress {
  totalBatches: number;
  completedBatches: number;
  currentBatch: number | null;
  processedTurns: number;
  totalTurns: number;
  phase?: 'turns' | 'short' | 'middle' | 'long' | 'saving';
  currentTurn?: number | null;
}

export interface MemoryRebuildFailedBatch {
  batchIndex: number;
  kind: MemoryCompressionSource['kind'];
  sourceTurns: { start: number; end: number };
  /** Exact materials sent to the failed summarization request. */
  items: string[];
  fallbackSummary: string;
  code: string;
  message: string;
  attemptCount: number;
}

export interface MemoryRebuildTask {
  persistence?: 'pending' | 'saved' | 'failed';
  rebuildScope?: ReturnType<typeof prepareMemoryRebuildScope>;
  id: string;
  status: MemoryRebuildTaskStatus;
  range: { start: number; end: number };
  batchSize: number;
  turns: MemoryRebuildTurn[];
  batches: MemoryRebuildTurn[][];
  nextBatchIndex: number;
  nextTurnIndex: number;
  turnSummaries: MemorySourceItem[];
  stagedIrminsul: IrminsulMemory;
  phase: 'turns' | 'compression' | 'ready';
  staging: 记忆系统;
  /** Internal provenance retained across batches; not persisted as gameplay memory. */
  stagingItems: {
    short: StagingItem[];
    middle: StagingItem[];
    long: StagingItem[];
  };
  failedBatch?: MemoryRebuildFailedBatch;
  blockedReason?: string;
  warnings: string[];
  progress: MemoryRebuildProgress;
}

export interface CreateMemoryRebuildTaskOptions {
  sourceState?: MemoryMaintenanceState;
  chatHistory: readonly 聊天消息[];
  batchSize: number;
  range?: MemoryRebuildRange;
  settings?: MemoryRebuildSettings;
  id?: string;
}

export interface RunMemoryRebuildTaskOptions {
  summarizer: MemoryRebuildSummarizer;
  settings?: MemoryRebuildSettings;
  signal?: AbortSignal;
  onProgress?: (progress: MemoryRebuildProgress) => void;
}

export interface ExtractMemoryRebuildTurnsResult {
  turns: MemoryRebuildTurn[];
  warnings: string[];
}

const DEFAULT_PROMPTS: Required<MemoryRebuildPrompts> = {
  short: '请将这些回合整理为短期记忆，保留事实、事件、关系变化、承诺、冲突和未完事项。',
  middle: '请将这些短期记忆整理为中期记忆，保留跨回合仍然有效的事实、关系和未完事项。',
  long: '请将这些中期记忆整理为长期记忆，只保留稳定、可复用且会影响后续剧情的事实。',
};

function isApiEnabled(settings: MemoryRebuildSettings | undefined): boolean {
  if (!settings) return true;
  if (settings.apiEnabled === false) return false;
  // The Chinese key is used by the product settings model. Keep this lookup
  // string-based so this service remains independent of that model's type.
  if ((settings as Record<string, unknown>)['启用中短长期API总结'] === false) return false;
  return true;
}

function getPrompts(settings: MemoryRebuildSettings): Required<MemoryRebuildPrompts> {
  const configured = settings.prompts ?? {};
  const raw = settings as Record<string, unknown>;
  return {
    short: String(configured.short ?? raw['即时转短期提示词'] ?? DEFAULT_PROMPTS.short),
    middle: String(configured.middle ?? raw['短期转中期提示词'] ?? DEFAULT_PROMPTS.middle),
    long: String(configured.long ?? raw['中期转长期提示词'] ?? raw['短期转长期提示词'] ?? DEFAULT_PROMPTS.long),
  };
}

function parseTurn(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^\d+$/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
    || (error instanceof Error && /aborted|abort/i.test(error.message));
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '未知错误');
  return raw
    .replace(/bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key\s*[:=]\s*[^,;\s]+/gi, 'apiKey=[redacted]')
    .slice(0, 500);
}

function uniqueMessageIds(history: readonly 聊天消息[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const message of history) {
    if (seen.has(message.id)) duplicates.push(message.id);
    seen.add(message.id);
  }
  return duplicates;
}

/**
 * Pair user messages with the assistant response for the same gameTime. A
 * reroll that leaves multiple assistant messages keeps the newest response.
 */
export function extractMemoryRebuildTurns(
  chatHistory: readonly 聊天消息[],
): ExtractMemoryRebuildTurnsResult {
  const warnings: string[] = [];
  const duplicateIds = uniqueMessageIds(chatHistory);
  if (duplicateIds.length) {
    warnings.push(`发现重复消息 ID：${Array.from(new Set(duplicateIds)).slice(0, 8).join('、')}`);
  }

  const duplicated = new Set(duplicateIds);
  const users: Array<{ message: 聊天消息; index: number; turn: number }> = [];
  const assistants: Array<{ message: 聊天消息; index: number; turn: number | null }> = [];
  for (let index = 0; index < chatHistory.length; index += 1) {
    const message = chatHistory[index];
    if (!message || !message.id?.trim() || duplicated.has(message.id)) continue;
    if (message.role === 'user') {
      const parsedTurn = parseTurn(message.gameTime);
      if (parsedTurn === null) {
        warnings.push(`用户消息 ${message.id} 缺少可靠回合号，已保留原文但未纳入重建。`);
        continue;
      }
      users.push({ message, index, turn: parsedTurn });
    } else if (message.role === 'assistant') {
      const parsedTurn = parseTurn(message.gameTime);
      if (message.isStreaming) { warnings.push(`AI 消息 ${message.id} 仍在生成，已跳过。`); continue; }
      if (parsedTurn === null) { warnings.push(`AI 消息 ${message.id} 缺少可靠回合号，已跳过。`); continue; }
      assistants.push({ message, index, turn: parsedTurn });
    }
  }

  const usedUsers = new Set<string>();
  const pairs = new Map<number, MemoryRebuildTurn>();
  for (const assistant of assistants) {
    // A reroll can leave two assistant messages for one gameTime. Reuse the
    // already paired user for that exact turn so the newest assistant replaces
    // the old one instead of being silently dropped.
    const existingPair = assistant.turn === null ? undefined : pairs.get(assistant.turn);
    const candidate = existingPair
      ? users.find((user) => user.message.id === existingPair.userId)
      : users
        .filter((user) => !usedUsers.has(user.message.id) && user.index < assistant.index)
        .filter((user) => assistant.turn === null || user.turn === assistant.turn)
        .at(-1);
    if (!candidate) {
      warnings.push(`AI 消息 ${assistant.message.id} 没有可配对的用户输入，已跳过。`);
      continue;
    }
    usedUsers.add(candidate.message.id);
    const turn = assistant.turn ?? candidate.turn;
    if (!turn || !Number.isInteger(turn) || turn < 1) {
      warnings.push(`AI 消息 ${assistant.message.id} 无法确定回合号，已跳过。`);
      continue;
    }
    const parsed = assistant.message.parsedResponse
      ? narrativeTurnBodyText(assistant.message.parsedResponse)
      : assistant.message.content?.trim() || '';
    const userInput = candidate.message.content?.trim() || '';
    if (!parsed) {
      warnings.push(`第 ${turn} 回合没有可用 AI 正文，已跳过。`);
      continue;
    }
    if (!userInput) { warnings.push(`第 ${turn} 回合玩家输入缺失，已跳过。`); continue; }
    if (pairs.has(turn)) warnings.push(`第 ${turn} 回合存在多个 AI 回复，采用最后一条。`);
    pairs.set(turn, {
      turn,
      userId: candidate.message.id,
      assistantId: assistant.message.id,
      userInput,
      body: parsed,
      sourceMessageIds: [candidate.message.id, assistant.message.id],
      momentRange: { start: null, end: null, sourceIds: [candidate.message.id, assistant.message.id] },
    });
  }

  for (const user of users) {
    if (!usedUsers.has(user.message.id)) warnings.push(`第 ${user.turn ?? '?'} 回合没有落地 AI 正文，未纳入重建。`);
  }

  return { turns: Array.from(pairs.values()).sort((left, right) => left.turn - right.turn), warnings };
}

function cloneMemory(memory: 记忆系统): 记忆系统 {
  return structuredClone(memory);
}

interface StagingItem {
  text: string;
  start: number;
  end: number;
}

function formatTurn(turn: MemoryRebuildTurn): string {
  return [
    `【第 ${turn.turn} 回合】`,
    `玩家输入：${turn.userInput || '（空）'}`,
    `正文：${turn.body}`,
  ].join('\n');
}

function readSummaryResult(result: MemoryRebuildSummaryResult):
  | { ok: true; summary: string }
  | { ok: false; fallback: string; code: string; message: string } {
  if ('ok' in result) {
    if (result.ok && result.summary.trim()) return { ok: true, summary: result.summary.trim() };
    if (!result.ok) {
      return {
        ok: false,
        fallback: result.fallback?.trim() ?? '',
        code: result.code ?? 'request_failed',
        message: result.message ?? '记忆总结失败',
      };
    }
  }
  const legacy = result as {
    summary?: string;
    usedFallback?: boolean;
    usedLocal?: boolean;
    code?: string;
    message?: string;
    failureCode?: string;
    failureMessage?: string;
  };
  const summary = String(legacy.summary ?? '').trim();
  if (legacy.usedFallback) {
    return {
      ok: false,
      fallback: summary,
      code: legacy.failureCode ?? legacy.code ?? 'request_failed',
      message: legacy.failureMessage ?? legacy.message ?? '记忆总结使用了本地 fallback',
    };
  }
  if (summary) return { ok: true, summary };
  return { ok: false, fallback: '', code: 'empty_output', message: '记忆总结返回空内容' };
}

function normalizeSettings(settings?: MemoryRebuildSettings): MemoryRebuildSettings {
  return settings ?? {};
}

function makeTaskId(): string {
  return `memory_rebuild_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createMemoryRebuildTask(options: CreateMemoryRebuildTaskOptions): MemoryRebuildTask {
  const extracted = extractMemoryRebuildTurns(options.chatHistory);
  const availableTurns = extracted.turns;
  const firstTurn = availableTurns[0]?.turn ?? 1;
  const lastTurn = availableTurns.at(-1)?.turn ?? firstTurn;
  const requestedStart = Number.isFinite(options.range?.start) ? Math.trunc(options.range!.start!) : firstTurn;
  const requestedEnd = Number.isFinite(options.range?.end) ? Math.trunc(options.range!.end!) : lastTurn;
  const start = Math.min(requestedStart, requestedEnd);
  const end = Math.max(requestedStart, requestedEnd);
  const turns = availableTurns.filter((turn) => turn.turn >= start && turn.turn <= end).map(turn => {
    const message = options.chatHistory.find(item => item.id === turn.assistantId)!;
    const range = resolveRebuildTurnMoment(turn.turn, message, options.sourceState ?? { memory: 创建空记忆系统(), irminsul: { entries: [] } });
    return { ...turn, momentRange: { start: range?.start ?? null, end: range?.end ?? null, sourceIds: [...turn.sourceMessageIds] } };
  });
  const knownTurns = new Set(turns.map(turn => turn.turn));
  const missing: number[] = [];
  for (let turn = Math.max(1, start); turn <= end && missing.length < 100; turn++) if (!knownTurns.has(turn)) missing.push(turn);
  const batchSize = Math.max(1, Math.min(100, Math.trunc(Number(options.batchSize) || 15)));
  const batches: MemoryRebuildTurn[][] = [];
  for (let index = 0; index < turns.length; index += batchSize) batches.push(turns.slice(index, index + batchSize));
  const rebuildScope = options.sourceState ? prepareMemoryRebuildScope(options.sourceState, { start, end }) : undefined;
  return {
    id: options.id ?? makeTaskId(),
    status: 'idle',
    range: { start, end },
    ...(rebuildScope ? { rebuildScope } : {}),
    batchSize,
    turns,
    batches,
    nextBatchIndex: 0,
    nextTurnIndex: 0, turnSummaries: [], stagedIrminsul: { entries: [] }, phase: 'turns',
    staging: 创建空记忆系统(),
    stagingItems: { short: [], middle: [], long: [] },
    warnings: [...extracted.warnings, ...(rebuildScope?.warnings ?? []), ...(missing.length ? [`缺失或不完整回合：${missing.join('、')}${missing.length === 100 ? '（仅列出前 100 项）' : ''}；不会生成虚假摘要。`] : [])],
    progress: {
      totalBatches: batches.length,
      completedBatches: 0,
      currentBatch: null,
      processedTurns: 0,
      totalTurns: turns.length,
      phase: 'turns', currentTurn: null,
    },
  };
}

function emitProgress(task: MemoryRebuildTask, callback?: (progress: MemoryRebuildProgress) => void): void {
  callback?.({ ...task.progress });
}

function syncStagingItems(task: MemoryRebuildTask): void {
  const sourceItems = readMemorySourceItems({ memory: task.staging, irminsul: task.stagedIrminsul });
  for (const layer of ['short', 'middle', 'long'] as const) {
    task.stagingItems[layer] = sourceItems.filter(item => item.layer === layer).map(item => ({
      text: item.text, start: item.sourceTurns[0] ?? 0, end: item.sourceTurns.at(-1) ?? 0,
    }));
  }
}

function stageTurn(task: MemoryRebuildTask, turn: MemoryRebuildTurn, summary: string): void {
  const raw = formatTurn(turn);
  const identity = fingerprintMemoryText(JSON.stringify([turn.sourceMessageIds, raw]));
  const anchorId = `rebuild_raw_${identity}`;
  const id = `rebuild_short_${identity}`;
  const item: MemorySourceItem = { id, layer: 'short', text: summary, sourceTurns: [turn.turn],
    sourceMessageIds: [...turn.sourceMessageIds], sourceEntryIds: [anchorId],
    momentRange: structuredClone(turn.momentRange), generatedFingerprint: fingerprintMemoryText(summary) };
  const common = { sourceTurns: [turn.turn], keywords: [], recordedAt: new Date().toISOString(), turn: turn.turn,
    sourceText: raw, sourceMomentRange: item.momentRange! };
  const anchor: IrminsulEntry = { ...common, id: anchorId, title: `第 ${turn.turn} 回合原文`, summary: raw, archiveType: 'refined' };
  const archive: IrminsulEntry = { ...common, id, title: `第 ${turn.turn} 回合摘要`, summary, archiveType: 'short',
    coveredEntryIds: [anchorId] };
  if (task.stagedIrminsul.entries.some(entry => (entry.id === id || entry.id === anchorId) && entry.sourceText !== raw)) {
    throw new Error('回合来源身份冲突，原记忆保持不变。');
  }
  task.stagedIrminsul = { entries: [...task.stagedIrminsul.entries, anchor, archive] };
  task.turnSummaries.push(item);
  task.staging = { ...task.staging, 短期记忆: [...task.staging.短期记忆, summary],
    短期归档ID: [...(task.staging.短期归档ID ?? []), id],
    来源回合: { ...task.staging.来源回合, [id]: [turn.turn] },
    生成文本指纹: { ...task.staging.生成文本指纹, [id]: item.generatedFingerprint! },
    来源时刻: { ...task.staging.来源时刻, [id]: item.momentRange! } };
  syncStagingItems(task);
}

/** Sequential per-turn summaries followed by the shared, resumable promotion pipeline. */
export async function runMemoryRebuildTask(task: MemoryRebuildTask, options: RunMemoryRebuildTaskOptions): Promise<MemoryRebuildTask> {
  if (['running', 'committed', 'cancelled', 'ready'].includes(task.status)) return task;
  const settings = normalizeSettings(options.settings);
  if (!isApiEnabled(settings) || !task.turns.length) {
    task.status = 'blocked';
    task.blockedReason = !isApiEnabled(settings) ? '中短长期 API 总结已关闭，请先开启后再进行批量重建。' : '所选范围没有完整回合，原记忆保持不变。';
    task.progress.currentBatch = null; emitProgress(task, options.onProgress); return task;
  }
  const previousFailure = task.failedBatch;
  task.status = 'running'; task.blockedReason = undefined; task.failedBatch = undefined;
  const cancelled = () => options.signal?.aborted || task.status === 'cancelled';
  const finishCancelled = () => { task.status = 'cancelled'; task.progress.currentBatch = null; task.progress.currentTurn = null; emitProgress(task, options.onProgress); return task; };
  const pause = (source: MemoryCompressionSource, failure: { fallback: string; code: string; message: string }) => {
    task.status = 'paused_failed';
    task.failedBatch = { batchIndex: task.nextBatchIndex, kind: source.kind, sourceTurns: source.sourceTurns!,
      items: [...source.items], fallbackSummary: failure.fallback, code: failure.code, message: failure.message,
      attemptCount: previousFailure?.kind === source.kind && JSON.stringify(previousFailure.items) === JSON.stringify(source.items)
        ? previousFailure.attemptCount + 1 : 1 };
    emitProgress(task, options.onProgress);
  };
  const prompts = getPrompts(settings);
  emitProgress(task, options.onProgress);
  while (task.nextTurnIndex < task.turns.length) {
    if (cancelled()) return finishCancelled();
    const turn = task.turns[task.nextTurnIndex]!;
    task.progress.currentBatch = Math.floor(task.nextTurnIndex / task.batchSize) + 1;
    task.progress.currentTurn = turn.turn; task.progress.phase = 'turns';
    emitProgress(task, options.onProgress);
    const source: MemoryCompressionSource = { kind: 'short', turn: turn.turn, items: [formatTurn(turn)], prompt: prompts.short,
      sourceTurns: { start: turn.turn, end: turn.turn } };
    let result: ReturnType<typeof readSummaryResult>;
    try { result = readSummaryResult(await options.summarizer(source, { settings, signal: options.signal })); }
    catch (error) {
      if (cancelled() || isAbortError(error)) return finishCancelled();
      result = { ok: false, fallback: '', code: 'request_failed', message: safeErrorMessage(error) };
    }
    if (cancelled()) return finishCancelled();
    if (!result.ok) { pause(source, result); return task; }
    stageTurn(task, turn, result.summary);
    task.nextTurnIndex++;
    task.progress.processedTurns = task.nextTurnIndex;
    task.progress.completedBatches = task.nextTurnIndex === task.turns.length ? task.batches.length : Math.floor(task.nextTurnIndex / task.batchSize);
    task.nextBatchIndex = task.progress.completedBatches;
    emitProgress(task, options.onProgress);
  }

  task.phase = 'compression';
  if (cancelled()) return finishCancelled();
  // Pending records here belong only to this uncommitted staging task, not live gameplay.
  const pendingIds = new Set((task.staging.失败草稿 ?? []).filter(draft => draft.status === 'pending').map(draft => draft.archiveEntryId));
  const retryState = { memory: { ...task.staging, 失败草稿: (task.staging.失败草稿 ?? []).filter(draft => draft.status !== 'pending') },
    irminsul: { entries: task.stagedIrminsul.entries.filter(entry => !pendingIds.has(entry.id)) } };
  const defaultThreshold = settings.compressionThreshold ?? MEMORY_LAYER_COMPRESSION_THRESHOLD;
  const thresholds = settings.thresholds ?? { immediateToShort: defaultThreshold, shortToMiddle: defaultThreshold, middleToLong: defaultThreshold };
  const layerSettings = { ...创建默认记忆系统设置(), 启用中短长期API总结: true,
    即时转短期阈值: thresholds.immediateToShort, 短期转中期阈值: thresholds.shortToMiddle, 中期转长期阈值: thresholds.middleToLong,
    即时转短期提示词: prompts.short, 短期转中期提示词: prompts.middle, 中期转长期提示词: prompts.long };
  let compressed: Awaited<ReturnType<typeof runMemoryLayerCompression>>;
  try {
    compressed = await runMemoryLayerCompression({ state: retryState, turn: task.range.end, settings: layerSettings, mode: 'rebuild',
      signal: options.signal, stopOnFailure: true,
      onProgress: progress => {
        task.progress.phase = progress.phase; task.progress.currentTurn = progress.currentTurn;
        emitProgress(task, options.onProgress);
      },
      summarizer: async (source, context) => {
        const result = readSummaryResult(await options.summarizer(source, { settings, signal: context.signal }));
        if (cancelled()) throw new DOMException('记忆重建已取消。', 'AbortError');
        return result;
      } });
  } catch (error) {
    if (cancelled() || isAbortError(error)) return finishCancelled();
    throw error;
  }
  if (cancelled()) return finishCancelled();
  task.staging = compressed.state.memory; task.stagedIrminsul = compressed.state.irminsul; syncStagingItems(task);
  const failed = compressed.failures[0];
  if (failed) {
    const items = await deserializeMemoryFailureSource(failed.sourceSnapshot);
    if (cancelled()) return finishCancelled();
    pause({ kind: failed.kind, turn: failed.sourceTurns.end, items, prompt: '', sourceTurns: failed.sourceTurns },
      { fallback: failed.fallbackSummary, code: failed.failureCode, message: failed.failureMessage });
    return task;
  }
  task.phase = 'ready'; task.status = 'ready'; task.progress.currentBatch = null; task.progress.currentTurn = null;
  emitProgress(task, options.onProgress); return task;
}

export function cancelMemoryRebuildTask(task: MemoryRebuildTask): MemoryRebuildTask {
  if (task.status !== 'committed') task.status = 'cancelled';
  task.progress.currentBatch = null;
  return task;
}

/** Return a detached staging copy only after the caller has confirmed ready. */
export function commitMemoryRebuildTask(task: MemoryRebuildTask): 记忆系统 | null {
  if (task.status !== 'ready') return null;
  task.status = 'committed';
  return cloneMemory(task.staging);
}

export function getMemoryRebuildPendingBatch(task: MemoryRebuildTask): MemoryRebuildFailedBatch | undefined {
  return task.failedBatch ? { ...task.failedBatch, items: [...task.failedBatch.items] } : undefined;
}
