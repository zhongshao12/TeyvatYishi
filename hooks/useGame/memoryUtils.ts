import {
  MEMORY_LAYER_COMPRESSION_THRESHOLD,
  deserializeMemoryFailureSource,
  normalizeMemorySystem as normalizeMemorySystemModel,
  serializeMemoryFailureSource,
  type 记忆失败草稿,
  type 记忆系统,
} from '@/models/memory';
import type { IrminsulEntry, IrminsulMemory } from '@/models/teyvat';
import type { API配置项, 记忆系统设置 } from '@/models/settings';
import type { NPC同行记忆来源, NPC同行记忆条目, NPC总结记忆条目 } from '@/models/npc';
import { summarizeMemoryBatch } from '@/services/memoryCompression';
import { 清理NPC同行记忆摘要 } from '@/utils/npcMemorySanitizer';
import { getActiveIrminsulEntries, hasCompleteIrminsulSourceCoverage, promoteIrminsulEntry } from '@/services/irminsulPromotion';
import type { WorldMoment, WorldMomentRange } from '@/models/teyvat/worldMoment';
import { combineWorldMomentRanges } from '@/services/worldMoment';
import { fingerprintMemoryText } from '@/models/memorySource';

const MEMORY_SNIPPET_LIMIT = 84;
const NPC_MEMORY_SUMMARY_LIMIT = 160;
const NPC_MEMORY_SYSTEM_NOISE_PATTERNS = [
  /剧情编织进度/,
  /当前进入第\s*\d+\s*段/,
  /最新归档/,
  /已归档/,
  /待解[:：]/,
  /判定[:：]/,
  /推进状态/,
  /注入健康/,
  /实际注入/,
  /门禁/,
];

export function buildImmediateMemory(userInput: string, aiResponse: string): string {
  const input = userInput.trim();
  const response = aiResponse.trim();
  return [`玩家输入：${input || '（空）'}`, `剧情回应：${response || '（空）'}`].join('\n');
}

function normalizeMemorySnippet(text: string): string {
  return (text || '')
    .replace(/\s+/g, ' ')
    .replace(/^【\s*[\d:.\-\s]+\s*】\s*/, '')
    .replace(/^[\-\u2022•·\d一二三四五六七八九十]+[\.、\)]\s*/, '')
    .trim();
}

function collectSummaryLines(items: string[], limit = 4): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of items) {
    const snippet = normalizeMemorySnippet(item);
    if (!snippet) continue;
    const key = snippet.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(snippet.length > MEMORY_SNIPPET_LIMIT ? `${snippet.slice(0, MEMORY_SNIPPET_LIMIT)}…` : snippet);
    if (lines.length >= limit) break;
  }
  return lines;
}

function isNpcMemorySystemNoise(text: string): boolean {
  return NPC_MEMORY_SYSTEM_NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

function compactNpcMemoryChunk(chunk: string[]): string {
  const cleaned = chunk
    .map((item) => 清理NPC同行记忆摘要(item))
    .map((item) => item.replace(/^\[压缩\]\s*/u, '').trim())
    .filter(Boolean)
    .filter((item) => !isNpcMemorySystemNoise(item));
  if (!cleaned.length) return '';

  const relationshipKeywords = /认可|信任|警觉|戒备|质询|邀请|同行|托付|承诺|感谢|配合|救下|救援|保护|冲突|和解|称呼|关系|好感|怀疑|赞赏|担心|约定/;
  const prioritized = [
    ...cleaned.filter((item) => relationshipKeywords.test(item)),
    ...cleaned.filter((item) => !relationshipKeywords.test(item)),
  ];
  const lines = collectSummaryLines([...prioritized].reverse(), 3).reverse();
  const summary = lines.join('；').replace(/\s*\/\s*/g, '；').trim();
  return summary.length > NPC_MEMORY_SUMMARY_LIMIT
    ? `${summary.slice(0, NPC_MEMORY_SUMMARY_LIMIT - 1)}…`
    : summary;
}

function pickSummaryClause(text: string, limit = 48): string {
  const cleaned = normalizeMemorySnippet(text)
    .replace(/[。！？!?；;]+$/g, '')
    .trim();
  if (!cleaned) return '（空）';
  const clause = cleaned
    .split(/[。！？!?；;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join('；');
  const source = clause || cleaned;
  return source.length > limit ? `${source.slice(0, limit)}…` : source;
}

function limitSummaryLine(text: string, limit: number): string {
  const cleaned = normalizeMemorySnippet(text);
  if (!cleaned) return '无';
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}…` : cleaned;
}

function buildArchiveSummary(items: string[], turn: number, kind: 'short' | 'middle' | 'long'): string {
  const lines = collectSummaryLines(items, kind === 'long' ? 5 : 4);
  const fallback = items.map(normalizeMemorySnippet).filter(Boolean).join('；');
  const body = lines.length ? lines.join('；') : fallback;
  const content = lines.length ? lines.map((line) => `- ${line}`) : [`- ${body || '空白'}`];
  const label = kind === 'long' ? '长期纪要' : kind === 'middle' ? '中期纪要' : '短期纪要';
  return [`【${label}·回合${turn}】`, ...content].join('\n');
}

function buildKeywords(items: string[]): string[] {
  return collectSummaryLines(items, 8)
    .flatMap((line) => line.split(/[，、；：:｜\s]+/))
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .slice(0, 16);
}

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of lines) {
    const normalized = raw.trim();
    if (!normalized) continue;
    const line = normalized.replace(/^[*•—·]\s*/, '- ');
    const key = line.replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(line.startsWith('- ') ? line : `- ${line}`);
  }
  return result;
}

function pruneMemorySourceMoments(system: 记忆系统): 记忆系统 {
  if (!system.来源时刻) return system;
  const activeIds = new Set([
    ...(system.即时记忆ID ?? []),
    ...(system.短期归档ID ?? []),
    ...(system.中期归档ID ?? []),
    ...(system.长期归档ID ?? []),
  ].filter((id): id is string => Boolean(id)));
  const sourceMoments = Object.fromEntries(
    Object.entries(system.来源时刻).filter(([id]) => activeIds.has(id)),
  );
  return { ...system, 来源时刻: sourceMoments };
}

export function addImmediateMemory(system: 记忆系统, memory: string, turn: number, moment?: WorldMoment, explicitId?: string): 记忆系统 {
  const id = explicitId?.trim() || (moment ? `memory_${moment.settlementId}_${turn}`
    : Number.isSafeInteger(turn) && turn >= 0 ? `memory_turn_${turn}_${fingerprintMemoryText(memory)}` : null);
  if (id) {
    const activeIds = [
      ...(system.即时记忆ID ?? []), ...(system.短期归档ID ?? []),
      ...(system.中期归档ID ?? []), ...(system.长期归档ID ?? []),
    ].filter((activeId): activeId is string => Boolean(activeId));
    if (activeIds.some((activeId) => activeId === id || system.来源时刻?.[activeId]?.sourceIds.includes(id))) return system;
  }
  const newMemories = [...system.即时记忆, memory];
  const newIds = [...(system.即时记忆ID ?? system.即时记忆.map(() => null)), id];
  return pruneMemorySourceMoments({
    ...system,
    即时记忆: newMemories,
    ...(id || system.即时记忆ID ? { 即时记忆ID: newIds } : {}),
    ...(id ? {
      来源回合: { ...system.来源回合, [id]: [turn] },
      生成文本指纹: { ...system.生成文本指纹, [id]: fingerprintMemoryText(memory) },
    } : {}),
    ...(id && moment ? { 来源时刻: {
      ...system.来源时刻,
      [id]: { start: moment, end: moment, sourceIds: [id] },
    } } : {}),
  });
}

export function checkCompressionThreshold(system: 记忆系统, threshold = MEMORY_LAYER_COMPRESSION_THRESHOLD): boolean {
  return system.即时记忆.length >= Math.max(1, Math.trunc(threshold));
}

function sourceRangeForIds(system: 记忆系统, ids: readonly (string | null)[]): WorldMomentRange | null {
  const ranges = ids.map((id) => id ? system.来源时刻?.[id] ?? null : null);
  return ranges.some(Boolean) ? combineWorldMomentRanges(ranges) : null;
}

export function compressToShortTerm(system: 记忆系统, turn: number, batchSize = MEMORY_LAYER_COMPRESSION_THRESHOLD): 记忆系统 {
  const size = Math.max(1, Math.trunc(batchSize));
  const recentRaw = system.即时记忆.slice(0, size);
  const summary = buildArchiveSummary(recentRaw, turn, 'short');
  const immediateIds = (system.即时记忆ID ?? system.即时记忆.map(() => null)).slice(0, size);
  const sourceMomentRange = sourceRangeForIds(system, immediateIds);
  const archiveId = sourceMomentRange ? archiveIdentity('short', turn, recentRaw, immediateIds.filter((id): id is string => Boolean(id)), 0) : null;

  return pruneMemorySourceMoments({
    ...system,
    即时记忆: system.即时记忆.slice(size),
    ...(system.即时记忆ID ? { 即时记忆ID: system.即时记忆ID.slice(size) } : {}),
    短期记忆: [...system.短期记忆, summary],
    短期归档ID: [...(system.短期归档ID ?? system.短期记忆.map(() => null)), archiveId],
    ...(archiveId && sourceMomentRange ? { 来源时刻: { ...system.来源时刻, [archiveId]: sourceMomentRange } } : {}),
  });
}

export function createShortTermArchiveEntry(rawMemories: string[], turn: number, summaryOverride?: string): IrminsulEntry {
  return {
    id: `recall_${Date.now()}`,
    title: `【记忆${String(Math.max(1, turn)).padStart(3, '0')}】`,
    archiveType: 'short',
    summary: summaryOverride?.trim() || buildArchiveSummary(rawMemories, turn, 'short'),
    sourceText: rawMemories.join('\n'),
    keywords: buildKeywords(rawMemories),
    sourceTurns: [turn],
    turn,
    recordedAt: new Date().toISOString(),
  };
}

export function checkMiddleTermThreshold(system: 记忆系统, threshold = MEMORY_LAYER_COMPRESSION_THRESHOLD): boolean {
  return system.短期记忆.length >= Math.max(1, Math.trunc(threshold));
}

export function compressToMiddleTerm(system: 记忆系统, turn: number, batchSize = MEMORY_LAYER_COMPRESSION_THRESHOLD): 记忆系统 {
  const size = Math.max(1, Math.trunc(batchSize));
  const oldest = system.短期记忆.slice(0, size);
  const compressed = buildArchiveSummary(oldest, turn, 'middle');
  const sourceIds = (system.短期归档ID ?? system.短期记忆.map(() => null)).slice(0, size);
  const sourceMomentRange = sourceRangeForIds(system, sourceIds);
  const archiveId = sourceMomentRange ? archiveIdentity('medium', turn, oldest, sourceIds.filter((id): id is string => Boolean(id)), 0) : null;
  return pruneMemorySourceMoments({
    ...system,
    短期记忆: system.短期记忆.slice(size),
    短期归档ID: (system.短期归档ID ?? system.短期记忆.map(() => null)).slice(size),
    中期记忆: [...(system.中期记忆 ?? []), compressed],
    中期归档ID: [...(system.中期归档ID ?? (system.中期记忆 ?? []).map(() => null)), archiveId],
    ...(archiveId && sourceMomentRange ? { 来源时刻: { ...system.来源时刻, [archiveId]: sourceMomentRange } } : {}),
  });
}

export function createMiddleTermArchiveEntry(shortMemories: string[], turn: number, summaryOverride?: string): IrminsulEntry {
  return {
    id: `recall_middle_${Date.now()}`,
    title: `【中期纪要 ${String(Math.max(1, turn)).padStart(3, '0')}】`,
    archiveType: 'medium',
    summary: summaryOverride?.trim() || buildArchiveSummary(shortMemories, turn, 'middle'),
    sourceText: shortMemories.join('\n'),
    keywords: buildKeywords(shortMemories),
    sourceTurns: [turn],
    turn,
    recordedAt: new Date().toISOString(),
  };
}

export function checkLongTermThreshold(system: 记忆系统, threshold = MEMORY_LAYER_COMPRESSION_THRESHOLD): boolean {
  return (system.中期记忆 ?? []).length >= Math.max(1, Math.trunc(threshold));
}

export function compressToLongTerm(system: 记忆系统, turn: number, batchSize = MEMORY_LAYER_COMPRESSION_THRESHOLD): 记忆系统 {
  const size = Math.max(1, Math.trunc(batchSize));
  const oldest = (system.中期记忆 ?? []).slice(0, size);
  const compressed = buildArchiveSummary(oldest, turn, 'long');
  const sourceIds = (system.中期归档ID ?? system.中期记忆.map(() => null)).slice(0, size);
  const sourceMomentRange = sourceRangeForIds(system, sourceIds);
  const archiveId = sourceMomentRange ? archiveIdentity('long', turn, oldest, sourceIds.filter((id): id is string => Boolean(id)), 0) : null;
  return pruneMemorySourceMoments({
    ...system,
    中期记忆: (system.中期记忆 ?? []).slice(size),
    中期归档ID: (system.中期归档ID ?? (system.中期记忆 ?? []).map(() => null)).slice(size),
    长期记忆: [...system.长期记忆, compressed],
    长期归档ID: [...(system.长期归档ID ?? system.长期记忆.map(() => null)), archiveId],
    ...(archiveId && sourceMomentRange ? { 来源时刻: { ...system.来源时刻, [archiveId]: sourceMomentRange } } : {}),
  });
}

export function createLongTermArchiveEntry(shortMemories: string[], turn: number, summaryOverride?: string): IrminsulEntry {
  return {
    id: `recall_long_${Date.now()}`,
    title: `【长期纪要 ${String(Math.max(1, turn)).padStart(3, '0')}】`,
    archiveType: 'long',
    summary: summaryOverride?.trim() || buildArchiveSummary(shortMemories, turn, 'long'),
    sourceText: shortMemories.join('\n'),
    keywords: buildKeywords(shortMemories),
    sourceTurns: [turn],
    turn,
    recordedAt: new Date().toISOString(),
  };
}

export function buildTurnRecallSummary(input: {
  userInput: string;
  body: string;
  memory: string;
  turn: number;
  worldEvents?: string[];
  actionOptions?: string[];
}): string {
  const turnLabel = String(Math.max(1, input.turn)).padStart(3, '0');
  const lines: string[] = [
    `- 玩家输入：${limitSummaryLine(input.userInput, 90)}`,
    `- 正文推进：${pickSummaryClause(input.body, 64)}`,
    `- 承接记忆：${input.memory.trim() ? pickSummaryClause(input.memory, 64) : '无'}`,
  ];

  if (input.worldEvents?.length) {
    lines.push(`- 世界变化：${input.worldEvents.map((item) => pickSummaryClause(item, 40)).join(' / ')}`);
  }
  if (input.actionOptions?.length) {
    lines.push(`- 行动选项：${input.actionOptions.map((item) => pickSummaryClause(item, 36)).join(' / ')}`);
  }

  return `【回合${turnLabel} 纪要】\n${dedupeLines(lines).slice(0, 6).join('\n')}`;
}

export function createTurnRecallEntry(input: {
  userInput: string;
  body: string;
  memory?: string;
  turn: number;
  worldEvents?: string[];
  actionOptions?: string[];
}): IrminsulEntry {
  const rawPieces = [
    `玩家输入：${input.userInput.trim() || '（空）'}`,
    `正文：${input.body.trim() || '（空）'}`,
    input.memory?.trim() ? `回合小结：${input.memory.trim()}` : '',
    input.worldEvents?.length ? `动态世界：${input.worldEvents.join(' / ')}` : '',
    input.actionOptions?.length ? `行动选项：${input.actionOptions.join(' / ')}` : '',
  ].filter(Boolean);
  return {
    id: `recall_turn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: `【回合纪要 ${String(Math.max(1, input.turn)).padStart(3, '0')}】`,
    archiveType: 'refined',
    summary: buildTurnRecallSummary({
      userInput: input.userInput,
      body: input.body,
      memory: input.memory ?? '',
      turn: input.turn,
      worldEvents: input.worldEvents,
      actionOptions: input.actionOptions,
    }),
    sourceText: rawPieces.join('\n'),
    keywords: buildKeywords(rawPieces),
    sourceTurns: [input.turn],
    turn: input.turn,
    recordedAt: new Date().toISOString(),
  };
}

export function upsertRecallEntry(system: IrminsulMemory, entry: IrminsulEntry): IrminsulMemory {
  return promoteIrminsulEntry(system, entry);
}

function archiveIdentity(kind: 'short' | 'medium' | 'long', turn: number, items: readonly string[], sourceIds: readonly string[], index: number): string {
  const payload = JSON.stringify([kind, turn, index, sourceIds, items]);
  let hash = 2166136261;
  for (const char of payload) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `recall_${kind}_${turn}_${(hash >>> 0).toString(36)}`;
}

function exactArchiveSources(memory: IrminsulMemory, items: readonly string[], sourceIds: readonly (string | null)[], archiveType: IrminsulEntry['archiveType']): IrminsulEntry[] | null {
  if (sourceIds.length !== items.length || sourceIds.some((id) => !id)) return null;
  const active = getActiveIrminsulEntries(memory).filter((entry) => entry.archiveType === archiveType);
  const sources = items.map((item, index) => active.filter((entry) => entry.id === sourceIds[index] && entry.summary === item));
  if (sources.some((matched) => matched.length !== 1)) return null;
  const unique = sources.map((matched) => matched[0]!).filter(Boolean);
  return new Set(unique.map((entry) => entry.id)).size === unique.length ? unique : null;
}

function archiveWithProvenance(
  base: IrminsulEntry,
  raw: string[],
  turn: number,
  index: number,
  sourceArchiveType: IrminsulEntry['archiveType'] | null,
  sourceIds: readonly (string | null)[],
  memory: IrminsulMemory,
  pending: boolean,
  sourceRanges: readonly (WorldMomentRange | null | undefined)[] = [],
): IrminsulEntry {
  const sources = sourceArchiveType ? exactArchiveSources(memory, raw, sourceIds, sourceArchiveType) : null;
  const sourceEntryIds = sources?.map((source) => source.id);
  const coveredEntryIds = sources && (pending || hasCompleteIrminsulSourceCoverage(sources, base.summary)) ? sourceEntryIds : undefined;
  const sourceTurns = sources?.length
    ? [...new Set(sources.flatMap((source) => source.sourceTurns))].sort((a, b) => a - b)
    : [turn];
  const ranges = sources?.map((source, index) => source.sourceMomentRange ?? sourceRanges[index] ?? null) ?? sourceRanges;
  const sourceMomentRange = ranges.length
    ? combineWorldMomentRanges(ranges)
    : null;
  return {
    ...base,
    id: archiveIdentity(base.archiveType as 'short' | 'medium' | 'long', turn, raw, sourceEntryIds ?? [], index),
    sourceTurns,
    ...(coveredEntryIds?.length ? { coveredEntryIds } : {}),
    ...(sourceMomentRange ? { sourceMomentRange } : {}),
    status: pending ? 'pending' : 'active',
  };
}

export function autoCompressMemorySystem(
  system: 记忆系统,
  turn: number,
  settings: Pick<记忆系统设置, '即时转短期阈值' | '短期转中期阈值' | '中期转长期阈值' | '短期转长期阈值'>,
): 记忆系统 {
  let next = system;
  const immediateThreshold = Math.max(1, Math.trunc(settings.即时转短期阈值 || MEMORY_LAYER_COMPRESSION_THRESHOLD));
  const shortThreshold = Math.max(1, Math.trunc(settings.短期转中期阈值 || settings.短期转长期阈值 || MEMORY_LAYER_COMPRESSION_THRESHOLD));
  const middleThreshold = Math.max(1, Math.trunc(settings.中期转长期阈值 || MEMORY_LAYER_COMPRESSION_THRESHOLD));

  while (next.即时记忆.length >= immediateThreshold) {
    next = compressToShortTerm(next, turn, immediateThreshold);
  }
  while (next.短期记忆.length >= shortThreshold) {
    next = compressToMiddleTerm(next, turn, shortThreshold);
  }
  while ((next.中期记忆 ?? []).length >= middleThreshold) {
    next = compressToLongTerm(next, turn, middleThreshold);
  }
  return next;
}

export function autoCompressMemorySystemWithArchives(
  system: 记忆系统,
  turn: number,
  settings: Pick<记忆系统设置, '即时转短期阈值' | '短期转中期阈值' | '中期转长期阈值' | '短期转长期阈值'>,
): { memory: 记忆系统; archives: IrminsulEntry[] } {
  let next = system;
  const archives: IrminsulEntry[] = [];
  const immediateThreshold = Math.max(1, Math.trunc(settings.即时转短期阈值 || MEMORY_LAYER_COMPRESSION_THRESHOLD));
  const shortThreshold = Math.max(1, Math.trunc(settings.短期转中期阈值 || settings.短期转长期阈值 || MEMORY_LAYER_COMPRESSION_THRESHOLD));
  const middleThreshold = Math.max(1, Math.trunc(settings.中期转长期阈值 || MEMORY_LAYER_COMPRESSION_THRESHOLD));

  while (next.即时记忆.length >= immediateThreshold) {
    const raw = next.即时记忆.slice(0, immediateThreshold);
    archives.push(createShortTermArchiveEntry(raw, turn));
    next = compressToShortTerm(next, turn, immediateThreshold);
  }
  while (next.短期记忆.length >= shortThreshold) {
    const raw = next.短期记忆.slice(0, shortThreshold);
    archives.push(createMiddleTermArchiveEntry(raw, turn));
    next = compressToMiddleTerm(next, turn, shortThreshold);
  }
  while ((next.中期记忆 ?? []).length >= middleThreshold) {
    const raw = (next.中期记忆 ?? []).slice(0, middleThreshold);
    archives.push(createLongTermArchiveEntry(raw, turn));
    next = compressToLongTerm(next, turn, middleThreshold);
  }
  return { memory: next, archives };
}

export async function autoCompressMemorySystemWithArchivesAsync(
  system: 记忆系统,
  turn: number,
  settings: 记忆系统设置,
  mainConfig: API配置项,
  signal?: AbortSignal,
  irminsul?: IrminsulMemory,
): Promise<{
  memory: 记忆系统;
  archives: IrminsulEntry[];
  failures: 记忆失败草稿[];
  usedFallback: boolean;
  usedModel: boolean;
  usedLocal: boolean;
  blockedReason?: string;
}> {
  const { runMemoryLayerCompression } = await import('@/services/memoryLayerCompression');
  const result = await runMemoryLayerCompression({
    state: { memory: system, irminsul: irminsul ?? { entries: [] } },
    turn, settings, mode: 'automatic', signal,
    summarizer: (source, context) => summarizeMemoryBatch(source, settings, mainConfig, context.signal, settings.记忆总结API?.retryCount ?? 2),
  });
  return { memory: result.state.memory, archives: result.patch.archiveUpserts, failures: result.failures,
    usedFallback: result.usedFallback, usedModel: result.usedModel, usedLocal: result.usedLocal,
    blockedReason: result.blockedReason };
}

export interface RetryMemoryFailureDraftResult {
  memory: 记忆系统;
  irminsul?: IrminsulMemory;
  draft: 记忆失败草稿;
  usedModel: boolean;
  usedFallback: boolean;
}

/**
 * 使用失败发生时保存的 sourceSnapshot 重试；不会重新从当前 chatHistory 拼材料。
 * 成功时只替换原 fallback，且清理已解决草稿的原文 payload，避免长期存档膨胀。
 */
export async function retryMemoryFailureDraft(
  system: 记忆系统,
  draftId: string,
  settings: 记忆系统设置,
  mainConfig: API配置项,
  signal?: AbortSignal,
  irminsul?: IrminsulMemory,
): Promise<RetryMemoryFailureDraftResult> {
  const draft = (system.失败草稿 ?? []).find((item) => item.id === draftId);
  if (!draft) throw new Error('找不到对应的失败草稿。');
  if (draft.status === 'resolved' || draft.status === 'ignored') {
    return { memory: system, irminsul, draft, usedModel: false, usedFallback: false };
  }
  if (draft.origin === 'batch_rebuild') {
    throw new Error('这份草稿来自批量重建，请重新运行批量重建；原记忆仍保持不变。');
  }
  if (settings.启用中短长期API总结 === false) {
    throw new Error('请先开启“启用中短长期 API 总结”再重试失败草稿。');
  }

  const items = await deserializeMemoryFailureSource(draft.sourceSnapshot);
  if (signal?.aborted) throw new DOMException('记忆整理已取消。', 'AbortError');
  if (draft.sourceIds?.length) {
    const { readMemoryCompressionMaterials, resolveMemoryCompressionSources } = await import('@/services/memoryLayerCompression');
    const currentState = { memory: system, irminsul: irminsul ?? { entries: [] } };
    const expectedLayer = draft.kind === 'short' ? 'immediate' : draft.kind === 'middle' ? 'short' : 'middle';
    const sources = resolveMemoryCompressionSources(currentState, draft.sourceIds, expectedLayer);
    if (new Set(draft.sourceIds).size !== draft.sourceIds.length || sources.some(item => !item)
      || JSON.stringify(readMemoryCompressionMaterials(currentState, sources.filter((item): item is NonNullable<typeof item> => Boolean(item))).items) !== JSON.stringify(items)) {
      const conflicted: 记忆失败草稿 = { ...draft, status: 'pending', failureCode: 'source_changed', failureMessage: '原始来源已修改或删除，未发起重试。', updatedAt: Date.now() };
      return { memory: { ...system, 失败草稿: (system.失败草稿 ?? []).map(item => item.id === draft.id ? conflicted : item) },
        irminsul, draft: conflicted, usedModel: false, usedFallback: false };
    }
  }
  const prompt = draft.kind === 'short'
    ? settings.即时转短期提示词
    : draft.kind === 'middle'
      ? settings.短期转中期提示词
      : settings.中期转长期提示词 || settings.短期转长期提示词;
  const result = await summarizeMemoryBatch(
    {
      kind: draft.kind,
      turn: draft.sourceTurns.end,
      items,
      prompt,
      sourceTurns: draft.sourceTurns,
    },
    settings,
    mainConfig,
    signal,
    settings.记忆总结API?.retryCount ?? 2,
  );
  if (result.usedLocal) {
    // 开关在请求前已检查，这个分支只是防止调用方传入被并发修改的设置。
    throw new Error('记忆总结 API 已关闭，未发起重试请求。');
  }
  if (signal?.aborted) throw new DOMException('记忆整理已取消。', 'AbortError');

  const now = Date.now();
  if (result.failureCode) {
    const updated: 记忆失败草稿 = {
      ...draft,
      status: 'pending',
      failureCode: result.failureCode,
      failureMessage: result.failureMessage ?? draft.failureMessage,
      attemptCount: Math.max(0, draft.attemptCount) + 1,
      updatedAt: now,
    };
    return {
      memory: {
        ...system,
        失败草稿: (system.失败草稿 ?? []).map((item) => item.id === draft.id ? updated : item),
      },
      draft: updated,
      irminsul,
      usedModel: false,
      usedFallback: true,
    };
  }

  if (draft.sourceIds?.length) {
    const { runMemoryLayerCompression } = await import('@/services/memoryLayerCompression');
    const { mergeMemoryMaintenancePatch } = await import('@/services/memoryMaintenanceMerge');
    const sourceText = draft.kind === 'short' ? '即时记忆' : draft.kind === 'middle' ? '短期记忆' : '中期记忆';
    const sourceIdField = draft.kind === 'short' ? '即时记忆ID' : draft.kind === 'middle' ? '短期归档ID' : '中期归档ID';
    const ids = new Set(draft.sourceIds);
    const selected = system[sourceText].flatMap((text, index) => ids.has(system[sourceIdField]?.[index] ?? '') ? [{ text, id: system[sourceIdField]?.[index] ?? null }] : []);
    const partial: 记忆系统 = { ...system, 即时记忆: [], 即时记忆ID: [], 短期记忆: [], 短期归档ID: [], 中期记忆: [], 中期归档ID: [], 长期记忆: [], 长期归档ID: [],
      [sourceText]: selected.map(item => item.text), [sourceIdField]: selected.map(item => item.id), 失败草稿: (system.失败草稿 ?? []).filter(item => item.id !== draft.id) };
    const selectedSettings = { ...settings, 即时转短期阈值: Number.MAX_SAFE_INTEGER, 短期转中期阈值: Number.MAX_SAFE_INTEGER, 中期转长期阈值: Number.MAX_SAFE_INTEGER,
      [draft.kind === 'short' ? '即时转短期阈值' : draft.kind === 'middle' ? '短期转中期阈值' : '中期转长期阈值']: draft.sourceIds.length };
    const compressed = await runMemoryLayerCompression({ state: { memory: partial, irminsul: irminsul ?? { entries: [] } },
      turn: draft.sourceTurns.end, settings: selectedSettings, mode: 'irminsul', sourceIds: draft.sourceIds, signal, summarizer: async () => result });
    if (compressed.failures.length || (!compressed.patch.added.length && !compressed.patch.archiveUpserts.some(entry => entry.status !== 'pending'))) {
      throw new Error('原始来源当前不可晋升，原文与失败草稿保持不变。');
    }
    const resolved: 记忆失败草稿 = { ...draft, status: 'resolved', sourceSnapshot: { ...draft.sourceSnapshot, payload: '' }, updatedAt: now };
    const base = { memory: system, irminsul: irminsul ?? { entries: [] } };
    const merged = mergeMemoryMaintenancePatch(base, base, { ...compressed.patch, failureUpserts: [resolved] });
    if (!merged.ok) throw new Error(merged.message);
    return { memory: merged.state.memory, irminsul: merged.state.irminsul, draft: resolved, usedModel: true, usedFallback: false };
  }

  const layerKey = draft.targetLayer;
  const current = system[layerKey];
  const archiveKey = layerKey === '短期记忆' ? '短期归档ID'
    : layerKey === '中期记忆' ? '中期归档ID' : '长期归档ID';
  const archiveIds = system[archiveKey];
  const matchingIndexes = current.flatMap((item, index) => item === draft.fallbackSummary ? [index] : []);
  const index = draft.archiveEntryId && archiveIds
    ? archiveIds.findIndex((id) => id === draft.archiveEntryId)
    : matchingIndexes.length === 1 ? matchingIndexes[0] ?? -1 : -1;
  const pendingArchive = draft.archiveEntryId && irminsul
    ? irminsul.entries.find((entry) => entry.id === draft.archiveEntryId) : undefined;
  if (index < 0 || current[index] !== draft.fallbackSummary
    || (draft.archiveEntryId && irminsul && (pendingArchive?.status !== 'pending' || pendingArchive.summary !== draft.fallbackSummary))) {
    const conflicted: 记忆失败草稿 = {
      ...draft,
      status: 'pending',
      failureCode: 'source_changed',
      failureMessage: '目标记忆中的本地 fallback 已被修改或移除，请先确认后再重试。',
      attemptCount: Math.max(0, draft.attemptCount) + 1,
      updatedAt: now,
    };
    return {
      memory: {
        ...system,
        失败草稿: (system.失败草稿 ?? []).map((item) => item.id === draft.id ? conflicted : item),
      },
      draft: conflicted,
      irminsul,
      usedModel: false,
      usedFallback: false,
    };
  }

  const nextLayer = [...current];
  nextLayer[index] = result.summary;
  const resolved: 记忆失败草稿 = {
    ...draft,
    status: 'resolved',
    sourceSnapshot: { ...draft.sourceSnapshot, payload: '' },
    updatedAt: now,
  };
  const claimedSources = pendingArchive?.coveredEntryIds?.flatMap((id) => irminsul?.entries.filter((entry) => entry.id === id) ?? []) ?? [];
  const completeCoverage = claimedSources.length === pendingArchive?.coveredEntryIds?.length
    && hasCompleteIrminsulSourceCoverage(claimedSources, result.summary);
  const nextIrminsul = pendingArchive && irminsul
    ? promoteIrminsulEntry(irminsul, { ...pendingArchive, summary: result.summary, status: 'active',
      coveredEntryIds: completeCoverage ? pendingArchive.coveredEntryIds : undefined })
    : irminsul;
  return {
    memory: {
      ...system,
      [layerKey]: nextLayer,
      失败草稿: (system.失败草稿 ?? []).map((item) => item.id === draft.id ? resolved : item),
    },
    draft: resolved,
    irminsul: nextIrminsul,
    usedModel: true,
    usedFallback: false,
  };
}

export function compressNpcMemories(memories: string[], threshold: number, prompt: string): string[] {
  const size = Math.max(1, Math.trunc(threshold || 15));
  if (!Array.isArray(memories)) return memories;

  let next = memories
    .map((item) => 清理NPC同行记忆摘要(item, prompt))
    .filter(Boolean)
    .filter((item) => !isNpcMemorySystemNoise(item));
  if (next.length < size) return next;

  while (next.length >= size) {
    const chunk = next.slice(0, size);
    const summary = compactNpcMemoryChunk(chunk);
    next = [...(summary ? [`[压缩] ${summary}`] : []), ...next.slice(size)];
  }
  return next;
}

type NpcMemoryLedgerCompressionInput = {
  npcId: string;
  entries: Array<NPC同行记忆条目 | string>;
  summaries?: Array<NPC总结记忆条目 | string>;
  threshold: number;
  prompt: string;
  turn: number;
  source?: NPC同行记忆来源;
};

type NpcMemoryLedgerCompressionResult = {
  memories: NPC同行记忆条目[];
  summaries: NPC总结记忆条目[];
  changed: boolean;
  summaryTriggered: boolean;
};

function normalizeLedgerKey(text: string): string {
  return normalizeMemorySnippet(text).replace(/\s+/g, '').toLowerCase();
}

function buildNpcSummaryId(npcId: string, turn: number, index: number): string {
  const safeNpcId = npcId.replace(/[^\w-]/g, '_') || 'unknown';
  return `npc_summary_${safeNpcId}_${Math.max(1, turn)}_${index}_${Math.random().toString(36).slice(2, 7)}`;
}

function buildNpcMemoryId(npcId: string, turn: number, index: number, source: NPC同行记忆来源): string {
  const safeNpcId = npcId.replace(/[^\w-]/g, '_') || 'unknown';
  const sourceKey = source === '手机' ? 'phone' : source === '正文' ? 'story' : source === '蒸汽鸟报' ? 'steambird' : source === '变量' ? 'var' : 'misc';
  return `npc_mem_${sourceKey}_${safeNpcId}_${Math.max(0, turn)}_${index}_${Math.random().toString(36).slice(2, 6)}`;
}

function buildNpcSummaryTurnRange(chunk: NPC同行记忆条目[], fallbackTurn: number): string {
  const turns = chunk
    .map((entry) => Number(entry.回合))
    .filter((turn) => Number.isFinite(turn) && turn > 0);
  if (!turns.length) return `第${Math.max(1, fallbackTurn)}回合前`;
  const min = Math.min(...turns);
  const max = Math.max(...turns);
  return min === max ? `第${min}回合` : `第${min}-${max}回合`;
}

function normalizeNpcSummaryEntry(
  item: NPC总结记忆条目 | string,
  index: number,
  npcId: string,
  turn: number,
): NPC总结记忆条目 | null {
  const source: Partial<NPC总结记忆条目> = typeof item === 'string' ? { 摘要: item } : item;
  const summary = 清理NPC同行记忆摘要(source.摘要 ?? '')
    .replace(/^\[压缩\]\s*/u, '')
    .trim();
  if (!summary || isNpcMemorySystemNoise(summary)) return null;
  return {
    ...(typeof item === 'string' ? {} : item),
    id: typeof source.id === 'string' && source.id.trim()
      ? source.id.trim()
      : buildNpcSummaryId(npcId, turn, index),
    摘要: summary,
    保留事实: source.保留事实?.map((text) => 清理NPC同行记忆摘要(text)).filter(Boolean),
    关系变化: source.关系变化?.map((text) => 清理NPC同行记忆摘要(text)).filter(Boolean),
    未完成事项: source.未完成事项?.map((text) => 清理NPC同行记忆摘要(text)).filter(Boolean),
  };
}

function mergeNpcSummaryEntries(entries: NPC总结记忆条目[]): NPC总结记忆条目[] {
  const seen = new Set<string>();
  const output: NPC总结记忆条目[] = [];
  for (const entry of entries) {
    const key = `${entry.回合范围 ?? ''}:${normalizeLedgerKey(entry.摘要)}`;
    if (!normalizeLedgerKey(entry.摘要) || seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

function normalizeNpcLedgerMemoryEntries(input: NpcMemoryLedgerCompressionInput): {
  memories: NPC同行记忆条目[];
  migratedSummaries: NPC总结记忆条目[];
  changed: boolean;
} {
  const seen = new Set<string>();
  const memories: NPC同行记忆条目[] = [];
  const migratedSummaries: NPC总结记忆条目[] = [];
  let changed = false;

  input.entries.forEach((entry, index) => {
    const originalText = typeof entry === 'string' ? entry : entry?.摘要 ?? '';
    const cleaned = 清理NPC同行记忆摘要(originalText, input.prompt);
    if (!cleaned || isNpcMemorySystemNoise(cleaned)) {
      changed = true;
      return;
    }
    if (cleaned.startsWith('[压缩]')) {
      const summary = normalizeNpcSummaryEntry(
        {
          id: typeof entry === 'string' ? buildNpcSummaryId(input.npcId, input.turn, index) : `migrated_${entry.id}`,
          回合范围: typeof entry === 'string' || !entry.回合 ? undefined : `第${entry.回合}回合前`,
          条数: 1,
          摘要: cleaned,
          ...(typeof entry !== 'string' && entry.worldMoment ? { sourceMomentRange: {
            start: entry.worldMoment, end: entry.worldMoment, sourceIds: [entry.id],
          } } : {}),
        },
        index,
        input.npcId,
        input.turn,
      );
      if (summary) migratedSummaries.push(summary);
      changed = true;
      return;
    }

    const turn = typeof entry === 'string' ? input.turn : Number(entry.回合);
    const next: NPC同行记忆条目 = typeof entry === 'string'
      ? {
          id: buildNpcMemoryId(input.npcId, input.turn, index, input.source ?? '其他'),
          回合: input.turn,
          摘要: cleaned,
          来源: input.source ?? '其他',
          关联NPCID: [input.npcId],
        }
      : {
          ...entry,
          id: entry.id?.trim() || buildNpcMemoryId(input.npcId, input.turn, index, entry.来源 ?? input.source ?? '其他'),
          回合: Number.isFinite(turn) ? turn : input.turn,
          摘要: cleaned,
          来源: entry.来源 ?? input.source ?? '其他',
          关联NPCID: entry.关联NPCID?.length ? entry.关联NPCID : [input.npcId],
        };
    const key = `${next.回合 || 0}:${normalizeLedgerKey(next.摘要)}`;
    if (seen.has(key)) {
      changed = true;
      return;
    }
    seen.add(key);
    memories.push(next);
    if (typeof entry === 'string' || cleaned !== originalText || next.来源 !== (typeof entry === 'string' ? input.source : entry.来源)) {
      changed = true;
    }
  });

  return { memories, migratedSummaries, changed };
}

export function compressNpcMemoryLedger(input: NpcMemoryLedgerCompressionInput): NpcMemoryLedgerCompressionResult {
  const sourceEntries = Array.isArray(input.entries) ? input.entries : [];
  const sourceSummaries = Array.isArray(input.summaries) ? input.summaries : [];
  const normalizedInput = { ...input, entries: sourceEntries, summaries: sourceSummaries };
  const size = Math.max(1, Math.trunc(input.threshold || 15));
  const keepRecentCount = Math.min(4, Math.max(0, size - 1));
  const normalized = normalizeNpcLedgerMemoryEntries(normalizedInput);
  let memories = normalized.memories;
  let summaries = mergeNpcSummaryEntries([
    ...sourceSummaries
      .map((item, index) => normalizeNpcSummaryEntry(item, index, input.npcId, input.turn))
      .filter((item): item is NPC总结记忆条目 => Boolean(item)),
    ...normalized.migratedSummaries,
  ]);
  let summaryTriggered = false;

  if (memories.length >= size) {
    const recent = keepRecentCount > 0 ? memories.slice(-keepRecentCount) : [];
    const compressable = keepRecentCount > 0 ? memories.slice(0, -keepRecentCount) : memories;
    const chunkSize = Math.max(1, size);
    const generatedSummaries: NPC总结记忆条目[] = [];
    for (let index = 0; index < compressable.length; index += chunkSize) {
      const chunk = compressable.slice(index, index + chunkSize);
      const summary = compactNpcMemoryChunk(chunk.map((entry) => entry.摘要));
      if (!summary) continue;
      generatedSummaries.push({
        id: buildNpcSummaryId(input.npcId, input.turn, summaries.length + generatedSummaries.length),
        回合范围: buildNpcSummaryTurnRange(chunk, input.turn),
        条数: chunk.length,
        摘要: summary,
        sourceMomentRange: combineWorldMomentRanges(chunk.map((entry) => ({
          start: entry.worldMoment ?? null,
          end: entry.worldMoment ?? null,
          sourceIds: [entry.id],
        }))),
        保留事实: chunk
          .map((entry) => entry.摘要)
          .filter(Boolean)
          .slice(-5),
      });
    }
    if (generatedSummaries.length) {
      summaries = mergeNpcSummaryEntries([...summaries, ...generatedSummaries]);
      memories = recent;
      summaryTriggered = true;
    }
  }

  const changed =
    normalized.changed ||
    summaryTriggered ||
    normalized.migratedSummaries.length > 0 ||
    memories.length !== sourceEntries.length ||
    summaries.length !== sourceSummaries.length;

  return {
    memories,
    summaries,
    changed,
    summaryTriggered,
  };
}

export function formatMemoryForPrompt(system: 记忆系统): string {
  const sections: string[] = [];
  if (system.长期记忆.length) {
    sections.push(
      '【长期记忆】\n' + system.长期记忆.map((m, i) => `${i + 1}. ${m}`).join('\n'),
    );
  }
  if ((system.中期记忆 ?? []).length) {
    sections.push(
      '【中期记忆】\n' + (system.中期记忆 ?? []).map((m, i) => `${i + 1}. ${m}`).join('\n'),
    );
  }
  if (system.短期记忆.length) {
    sections.push(
      '【短期记忆】\n' + system.短期记忆.map((m, i) => `${i + 1}. ${m}`).join('\n'),
    );
  }
  return sections.join('\n\n');
}

/** Compatibility export for save/load callers; normalization lives in the model layer. */
export const normalizeMemorySystem = normalizeMemorySystemModel;
