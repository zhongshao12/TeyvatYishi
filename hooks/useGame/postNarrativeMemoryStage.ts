import type { 记忆系统 } from '@/models/memory';
import type { API配置项, 记忆系统设置 } from '@/models/settings';
import type { IrminsulMemory } from '@/models/teyvat/irminsul';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import { promoteIrminsulEntry } from '@/services/irminsulPromotion';
import { ensureMemorySourceIdentities } from '@/services/memoryLayerCompression';
import { mergeMemoryMaintenancePatch } from '@/services/memoryMaintenanceMerge';
import type { MemoryMaintenancePatch } from '@/models/memorySource';
import { tryAcquireMemoryMaintenanceLease } from '@/services/memoryMaintenanceRegistry';
import {
  addImmediateMemory,
  autoCompressMemorySystemWithArchivesAsync,
  buildImmediateMemory,
} from './memoryUtils';

/** Commit an awaited compression result without replacing edits made in the meantime. */
export function rebasePostNarrativeMemorySettlement(input: {
  baseMemory: 记忆系统;
  liveMemory: 记忆系统;
  compressedMemory: 记忆系统;
  baseIrminsul: IrminsulMemory;
  liveIrminsul: IrminsulMemory;
  compressedIrminsul: IrminsulMemory;
  userInput: string;
  narrativeSummary: string;
  body: string;
  moment: WorldMoment;
  patch?: MemoryMaintenancePatch;
}): { memory: 记忆系统; irminsul: IrminsulMemory; compressionDeferred: boolean } {
  if (input.patch) {
    const raw = buildImmediateMemory(input.userInput, [input.narrativeSummary ? `本回合小结：${input.narrativeSummary}` : '', input.body].filter(Boolean).join('\n\n'));
    const base = ensureMemorySourceIdentities({ memory: addImmediateMemory(input.baseMemory, raw, input.moment.turn, input.moment), irminsul: input.baseIrminsul });
    const live = ensureMemorySourceIdentities({ memory: addImmediateMemory(input.liveMemory, raw, input.moment.turn, input.moment), irminsul: input.liveIrminsul });
    const merged = mergeMemoryMaintenancePatch(base, live, input.patch);
    if (merged.ok) return { ...merged.state, compressionDeferred: false };
    return { memory: live.memory, irminsul: input.liveIrminsul, compressionDeferred: true };
  }
  const concurrentMemoryEdit = JSON.stringify(input.liveMemory) !== JSON.stringify(input.baseMemory);
  const baseById = new Map(input.baseIrminsul.entries.map((entry) => [entry.id, entry]));
  const liveById = new Map(input.liveIrminsul.entries.map((entry) => [entry.id, entry]));
  const compressedById = new Map(input.compressedIrminsul.entries.map((entry) => [entry.id, entry]));
  const coveredIds = new Set(input.compressedIrminsul.entries.flatMap((entry) => entry.coveredEntryIds ?? []));
  const sameEntry = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  const concurrentSourceEdit = input.baseIrminsul.entries.some((entry) => {
    const consumedOrUpdated = coveredIds.has(entry.id) || !sameEntry(entry, compressedById.get(entry.id));
    return consumedOrUpdated && !sameEntry(entry, liveById.get(entry.id));
  });
  const compressionDeferred = concurrentMemoryEdit || concurrentSourceEdit;
  const memory = compressionDeferred
    ? addImmediateMemory(input.liveMemory, buildImmediateMemory(input.userInput, [
        input.narrativeSummary ? `本回合小结：${input.narrativeSummary}` : '',
        input.body,
      ].filter(Boolean).join('\n\n')), input.moment.turn, input.moment)
    : input.compressedMemory;
  // Compression depends on both text memories and its covered world-tree
  // sources. A changed source invalidates the result, including its archives.
  if (compressionDeferred) return { memory, irminsul: input.liveIrminsul, compressionDeferred: true };
  // Apply the compression delta: retire covered sources, retain unrelated
  // live edits/additions, and never resurrect a record the player deleted.
  const entries = input.liveIrminsul.entries.flatMap((entry) => {
    const base = baseById.get(entry.id);
    if (!base || !sameEntry(base, entry)) return [entry];
    const compressed = compressedById.get(entry.id);
    return compressed ? [compressed] : [];
  });
  const keptIds = new Set(entries.map((entry) => entry.id));
  entries.push(...input.compressedIrminsul.entries.filter((entry) => !baseById.has(entry.id) && !keptIds.has(entry.id)));
  const irminsul = { entries };
  return { memory, irminsul, compressionDeferred: false };
}

type MemoryCompressionResult = Awaited<ReturnType<typeof autoCompressMemorySystemWithArchivesAsync>>;
type MemoryCompressor = (
  memory: 记忆系统,
  turn: number,
  settings: 记忆系统设置,
  mainConfig: API配置项,
  signal?: AbortSignal,
  irminsul?: IrminsulMemory,
) => Promise<MemoryCompressionResult>;

export interface PostNarrativeMemoryFeedback {
  status: 'success' | 'failed';
  detail: string;
  failCount?: number;
  retryHint?: string;
}

export interface PostNarrativeMemoryStageInput {
  memory: 记忆系统;
  irminsul: IrminsulMemory;
  userInput: string;
  narrativeSummary: string;
  body: string;
  turn: number;
  moment?: WorldMoment;
  settings: 记忆系统设置;
  mainConfig: API配置项;
  signal?: AbortSignal;
  compress?: MemoryCompressor;
  sessionId?: number;
}

export interface PostNarrativeMemoryStageResult {
  memory: 记忆系统;
  irminsul: IrminsulMemory;
  feedback: PostNarrativeMemoryFeedback;
  patch?: MemoryMaintenancePatch;
}

export async function settlePostNarrativeMemory(
  input: PostNarrativeMemoryStageInput,
): Promise<PostNarrativeMemoryStageResult> {
  const rawMemory = buildImmediateMemory(input.userInput, [
    input.narrativeSummary ? `本回合小结：${input.narrativeSummary}` : '',
    input.body,
  ].filter(Boolean).join('\n\n'));
  const memoryWithImmediate = addImmediateMemory(input.memory, rawMemory, input.turn, input.moment);
  const lease = input.sessionId === undefined ? undefined : tryAcquireMemoryMaintenanceLease(input.sessionId, null);
  if (lease === null) return { memory: memoryWithImmediate, irminsul: input.irminsul,
    feedback: { status: 'success', detail: '本回合原文已保留；已有记忆整理任务，自动压缩暂缓。' } };
  const abortLease = () => lease?.cancel();
  input.signal?.addEventListener('abort', abortLease, { once: true });
  if (input.signal?.aborted) abortLease();
  try {
  const compress = input.compress ?? autoCompressMemorySystemWithArchivesAsync;
  const compression = await compress(
    memoryWithImmediate,
    input.turn,
    input.settings,
    input.mainConfig,
    lease?.signal ?? input.signal,
    input.irminsul,
  );
  const irminsul = compression.archives.reduce(promoteIrminsulEntry, input.irminsul);
  const failureCount = compression.failures.length;
  const detail = failureCount > 0
    ? `${compression.failures.some(draft => draft.failureCode === 'unconfigured') ? '记忆总结 API 配置不完整；' : ''}记忆总结有 ${failureCount} 批 API 失败，原层来源与完整失败草稿均已保留，等待手动重试。`
    : compression.blockedReason
      ? `本回合原文已保留；${compression.blockedReason}${input.settings.启用中短长期API总结 === false ? ' API 已关闭，当前为本地模式。' : ''}`
    : compression.usedModel
      ? '即时/短期/中期/长期记忆已调用记忆总结 API 完成整理。'
      : '记忆总结 API 已关闭，已按阈值使用本地摘要整理；原始证据保留。';

  return {
    memory: compression.memory,
    irminsul,
    patch: compression.patch,
    feedback: failureCount > 0
      ? {
          status: 'failed',
          detail,
          failCount: failureCount,
          retryHint: '打开记忆系统的“失败草稿”页重新总结。',
        }
      : { status: 'success', detail },
  };
  } finally { input.signal?.removeEventListener('abort', abortLease); lease?.release(); }
}
