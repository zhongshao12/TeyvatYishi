import { MEMORY_LAYER_COMPRESSION_THRESHOLD, serializeMemoryFailureSource, type 记忆失败草稿, type 记忆系统 } from '@/models/memory';
import type { 记忆系统设置 } from '@/models/settings';
import { fingerprintMemoryText, memorySourceValuesEqual as same, type MemorySourceItem, type MemorySourceLayer, type MemoryLayerThresholds, type MemoryMaintenanceState, type MemoryMaintenancePatch, type MemoryMaintenanceProgress } from '@/models/memorySource';
import type { MemoryRebuildSummarizer } from './memoryRebuild';
import { readMemorySourceItems } from './memorySources';
import { combineWorldMomentRanges } from './worldMoment';
import { buildFallbackSummary } from './memoryCompression';
import { promoteIrminsulEntry } from './irminsulPromotion';
import { hasCompleteIrminsulSourceCoverage, hasVerifiedIrminsulCoverage, type IrminsulEntry } from '@/models/teyvat/irminsul';

const fields = {
  immediate: ['即时记忆', '即时记忆ID'], short: ['短期记忆', '短期归档ID'],
  middle: ['中期记忆', '中期归档ID'], long: ['长期记忆', '长期归档ID'],
} as const;
function threshold(value: number | undefined): number {
  return Number.isFinite(value) && value! > 0 ? Math.max(1, Math.trunc(value!)) : MEMORY_LAYER_COMPRESSION_THRESHOLD;
}
export function readMemoryLayerThresholds(settings: 记忆系统设置): MemoryLayerThresholds {
  return { immediateToShort: threshold(settings.即时转短期阈值),
    shortToMiddle: threshold(settings.短期转中期阈值 || settings.短期转长期阈值), middleToLong: threshold(settings.中期转长期阈值) };
}

/** Allocate identity without inventing historical turns or certifying an old player edit as generated. */
export function ensureMemorySourceIdentities(state: MemoryMaintenanceState): MemoryMaintenanceState {
  const memory = { ...state.memory };
  const used = new Set([...Object.values(fields).flatMap(([, idField]) => state.memory[idField] ?? []), ...state.irminsul.entries.map(entry => entry.id)]);
  for (const layer of Object.keys(fields) as MemorySourceLayer[]) {
    const [textField, idField] = fields[layer];
    memory[idField] = memory[textField].map((text, index) => {
      const existing = state.memory[idField]?.[index];
      if (existing?.trim()) return existing;
      const base = `memory_legacy_${layer}_${index}_${fingerprintMemoryText(text)}`;
      let id = base; let suffix = 0;
      while (used.has(id)) id = `${base}_${++suffix}`;
      used.add(id); return id;
    });
  }
  return { ...state, memory };
}

function writeLayer(memory: 记忆系统, source: MemorySourceLayer, selected: MemorySourceItem[], added: MemorySourceItem): 记忆系统 {
  const [textField, idField] = fields[source]; const [targetText, targetIds] = fields[added.layer];
  const ids = new Set(selected.map(item => item.id));
  const retained = memory[textField].flatMap((text, index) => ids.has(memory[idField]?.[index] ?? null) ? [] : [{ text, id: memory[idField]?.[index] ?? null }]);
  const next: 记忆系统 = { ...memory, [textField]: retained.map(item => item.text), [idField]: retained.map(item => item.id),
    [targetText]: [...memory[targetText], added.text], [targetIds]: [...(memory[targetIds] ?? memory[targetText].map(() => null)), added.id],
    来源回合: { ...memory.来源回合, [added.id!]: [...added.sourceTurns] },
    生成文本指纹: { ...memory.生成文本指纹, [added.id!]: added.generatedFingerprint! },
    ...(added.momentRange ? { 来源时刻: { ...memory.来源时刻, [added.id!]: added.momentRange } } : {}),
  };
  for (const id of ids) if (id) { delete next.来源回合?.[id]; delete next.生成文本指纹?.[id]; if (next.来源时刻) { next.来源时刻 = { ...next.来源时刻 }; delete next.来源时刻[id]; } }
  return next;
}

export function readMemoryCompressionMaterials(state: MemoryMaintenanceState, selected: MemorySourceItem[]) {
  const archives = selected.map(item => state.irminsul.entries.find(entry => entry.id === item.id && entry.summary === item.text && entry.status !== 'pending'));
  const raw = selected.map((item, index) => archives[index]?.sourceText ?? item.text);
  const items = selected.map((item, index) => archives[index]?.sourceText ? `摘要：${item.text}\n来源原文：\n${raw[index]}` : item.text);
  return { archives, raw, items };
}

/** Resolve an exact retry read-set, including archives that never had an array binding. */
export function resolveMemoryCompressionSources(state: MemoryMaintenanceState, ids: readonly string[], layer: MemorySourceLayer): (MemorySourceItem | undefined)[] {
  const bound = readMemorySourceItems(state);
  const rawBoundIds = new Set(Object.values(fields).flatMap(([, idField]) => state.memory[idField] ?? []));
  return ids.map(id => {
    if (rawBoundIds.has(id)) return bound.find(item => item.id === id && item.layer === layer);
    const entries = state.irminsul.entries.filter(entry => entry.id === id);
    const entry = entries[0];
    if (entries.length !== 1 || !entry || entry.status === 'pending' || !entry.sourceTurns.length || !entry.sourceText.trim()
      || entry.archiveType !== (layer === 'middle' ? 'medium' : layer)) return undefined;
    return { id, layer, text: entry.summary, sourceTurns: [...entry.sourceTurns], sourceMessageIds: [...(entry.sourceMomentRange?.sourceIds ?? [])],
      sourceEntryIds: [], momentRange: entry.sourceMomentRange ?? null, generatedFingerprint: null };
  });
}

export async function runMemoryLayerCompression(input: {
  state: MemoryMaintenanceState; turn: number; settings: 记忆系统设置; summarizer: MemoryRebuildSummarizer;
  mode: 'automatic' | 'rebuild' | 'manual' | 'irminsul'; signal?: AbortSignal;
  sourceIds?: readonly string[];
  stopOnFailure?: boolean;
  onProgress?: (progress: MemoryMaintenanceProgress) => void;
}): Promise<{ state: MemoryMaintenanceState; patch: MemoryMaintenancePatch; failures: 记忆失败草稿[]; blockedReason?: string; usedModel: boolean; usedLocal: boolean; usedFallback: boolean }> {
  const base = ensureMemorySourceIdentities(input.state);
  let state = base; const failures: 记忆失败草稿[] = []; const archiveReads = new Set<string>();
  const archiveHistory = new Map(base.irminsul.entries.map(entry => [entry.id, entry]));
  let usedModel = false; let usedLocal = false; let usedFallback = false; let batches = 0;
  const thresholds = readMemoryLayerThresholds(input.settings);
  const processedArchives = new Set<string>();
  const assertActive = () => { if (input.signal?.aborted) throw new DOMException('记忆整理已取消。', 'AbortError'); };
  const operations = [
    { layer: 'immediate', target: 'short', kind: 'short', size: thresholds.immediateToShort, prompt: input.settings.即时转短期提示词 },
    { layer: 'short', target: 'middle', kind: 'middle', size: thresholds.shortToMiddle, prompt: input.settings.短期转中期提示词 },
    { layer: 'middle', target: 'long', kind: 'long', size: thresholds.middleToLong, prompt: input.settings.中期转长期提示词 || input.settings.短期转长期提示词 },
  ] as const;
  promotion: for (const operation of operations) {
    while (true) {
      assertActive();
      const pendingIds = new Set((state.memory.失败草稿 ?? []).filter(draft => draft.status === 'pending' || draft.status === 'retrying').flatMap(draft => draft.sourceIds ?? []));
      const pendingFallbacks = new Set((state.memory.失败草稿 ?? []).filter(draft => !draft.sourceIds?.length && (draft.status === 'pending' || draft.status === 'retrying')).map(draft => draft.fallbackSummary));
      const bound = readMemorySourceItems(state);
      const eligible = bound.filter(item => {
        const linked = state.irminsul.entries.filter(entry => entry.id === item.id);
        return item.layer === operation.layer && item.id && (!input.sourceIds || input.sourceIds.includes(item.id)) && !pendingIds.has(item.id) && !pendingFallbacks.has(item.text)
          && (!item.generatedFingerprint || item.generatedFingerprint === fingerprintMemoryText(item.text))
          && (!linked.length || (linked.length === 1 && linked[0]?.summary === item.text && linked[0]?.status !== 'pending'
            && linked[0]?.archiveType === (item.layer === 'middle' ? 'medium' : item.layer)));
      });
      const selected = eligible.slice(0, operation.size);
      let standalone = false;
      if (selected.length < operation.size && input.mode === 'irminsul' && operation.layer !== 'immediate') {
        const boundIds = new Set(bound.flatMap(item => item.id ? [item.id] : []));
        const candidates = state.irminsul.entries.filter(entry => entry.archiveType === (operation.layer === 'middle' ? 'medium' : operation.layer)
          && entry.id.trim() && (!input.sourceIds || input.sourceIds.includes(entry.id)) && !boundIds.has(entry.id) && !processedArchives.has(entry.id) && !pendingIds.has(entry.id)
          && entry.status !== 'pending' && entry.sourceTurns.length > 0 && entry.sourceText.trim()
          && state.irminsul.entries.filter(other => other.id === entry.id).length === 1
          && !state.irminsul.entries.some(upper => upper.coveredEntryIds?.includes(entry.id) && hasVerifiedIrminsulCoverage(state.irminsul.entries.filter(other => other.id !== upper.id), upper)));
        if (candidates.length + selected.length >= operation.size) {
          standalone = selected.length === 0;
          selected.push(...candidates.slice(0, operation.size - selected.length).map(entry => ({
            id: entry.id, layer: operation.layer, text: entry.summary, sourceTurns: [...entry.sourceTurns], sourceMessageIds: [...(entry.sourceMomentRange?.sourceIds ?? [])],
            sourceEntryIds: [], momentRange: entry.sourceMomentRange ?? null, generatedFingerprint: null,
          })));
        }
      }
      if (selected.length < operation.size) break;
      const { archives, raw, items } = readMemoryCompressionMaterials(state, selected);
      for (const archive of archives) if (archive) archiveReads.add(archive.id);
      const sourceTurns = [...new Set(selected.flatMap(item => item.sourceTurns))].sort((a, b) => a - b);
      const sourceIds = selected.map(item => item.id!);
      const sourceRange = sourceTurns.length ? { start: sourceTurns[0]!, end: sourceTurns.at(-1)! } : { start: 0, end: 0 };
      const identity = fingerprintMemoryText(JSON.stringify([operation.kind, sourceIds, items]));
      const archiveId = `recall_${operation.kind}_${identity}`;
      const momentRange = combineWorldMomentRanges(selected.map(item => item.momentRange));
      if (!momentRange.sourceIds.length) momentRange.sourceIds = [...sourceIds];
      let summary = ''; let failureCode: 记忆失败草稿['failureCode'] | undefined; let failureMessage = '';
      input.onProgress?.({ phase: operation.kind, currentTurn: sourceRange.end || null, processedTurns: sourceTurns.length, totalTurns: sourceTurns.length });
      try {
        if (input.settings.启用中短长期API总结 === false) { summary = buildFallbackSummary(items, input.turn, operation.kind); usedLocal = true; }
        else {
          const result = await input.summarizer({ kind: operation.kind, turn: input.turn, items, prompt: operation.prompt, sourceTurns: sourceRange },
            { settings: { apiEnabled: true }, signal: input.signal });
          assertActive();
          if ('ok' in result) {
            if (result.ok) summary = result.summary.trim();
            else { summary = result.fallback ?? ''; failureCode = result.code === 'unconfigured' || result.code === 'empty_output' || result.code === 'source_changed' ? result.code : 'request_failed'; failureMessage = result.message ?? '记忆总结失败。'; }
          } else {
            summary = result.summary.trim();
            if (result.usedFallback) { failureCode = result.failureCode === 'unconfigured' || result.failureCode === 'empty_output' || result.failureCode === 'source_changed' ? result.failureCode : 'request_failed'; failureMessage = result.failureMessage ?? '记忆总结失败。'; }
            if (result.usedLocal) usedLocal = true;
          }
          if (!failureCode && summary) usedModel = true;
        }
        if (!failureCode && !summary.trim()) { failureCode = 'empty_output'; failureMessage = '记忆总结返回空内容。'; }
      } catch (error) {
        assertActive();
        if (error instanceof Error && error.name === 'AbortError') throw error;
        failureCode = 'request_failed'; failureMessage = '记忆总结请求失败；原始来源已保留。';
      }
      assertActive();
      const lowerArchives = archives.filter((entry): entry is IrminsulEntry => Boolean(entry));
      const complete = lowerArchives.length === selected.length && hasCompleteIrminsulSourceCoverage(lowerArchives, summary);
      const archive: IrminsulEntry = { id: archiveId, title: `【${operation.kind === 'short' ? '短期' : operation.kind === 'middle' ? '中期' : '长期'}纪要】`,
        archiveType: operation.target === 'middle' ? 'medium' : operation.target, summary: summary.trim() || '等待重新总结（原文已保留）', sourceText: raw.join('\n'),
        sourceTurns, keywords: [], recordedAt: new Date().toISOString(), turn: input.turn, sourceMomentRange: momentRange,
        ...(lowerArchives.length === selected.length && (failureCode || complete) ? { coveredEntryIds: lowerArchives.map(entry => entry.id) } : {}),
        status: failureCode ? 'pending' : 'active' };
      archiveHistory.set(archive.id, archive);
      if (state.irminsul.entries.some(entry => entry.id === archive.id && (entry.sourceText !== archive.sourceText || !same(entry.sourceTurns, archive.sourceTurns)))) {
        throw new Error('归档身份发生冲突，原文保持不变。');
      }
      if (failureCode) {
        usedFallback = true;
        const sourceSnapshot = await serializeMemoryFailureSource(items); assertActive();
        const now = Date.now();
        const draft: 记忆失败草稿 = { id: `memory_failure_${identity}`, archiveEntryId: archive.id, sourceIds, origin: 'automatic', kind: operation.kind,
          status: 'pending', sourceTurns: sourceRange, sourceSnapshot, targetLayer: fields[operation.target][0] as 记忆失败草稿['targetLayer'],
          fallbackSummary: archive.summary, failureCode, failureMessage, attemptCount: 1, createdAt: now, updatedAt: now };
        state = { memory: { ...state.memory, 失败草稿: [...(state.memory.失败草稿 ?? []), draft] }, irminsul: promoteIrminsulEntry(state.irminsul, archive) };
        failures.push(draft);
        if (input.stopOnFailure) break promotion;
      } else {
        const added: MemorySourceItem = { id: archive.id, layer: operation.target, text: archive.summary, sourceTurns,
          sourceMessageIds: [...momentRange.sourceIds], sourceEntryIds: [...(archive.coveredEntryIds ?? [])], momentRange, generatedFingerprint: fingerprintMemoryText(archive.summary) };
        state = { memory: standalone ? state.memory : writeLayer(state.memory, operation.layer, selected, added), irminsul: promoteIrminsulEntry(state.irminsul, archive) };
        batches++;
      }
      if (input.mode === 'irminsul') sourceIds.forEach(id => processedArchives.add(id));
    }
  }
  // A staged middle archive can be consumed again before commit. Rebase the surviving
  // proof onto original archives only when its actual text and turns verify every leaf.
  const originalIds = new Set(base.irminsul.entries.map(entry => entry.id));
  const originalLeaves = (id: string, seen = new Set<string>()): string[] => {
    if (originalIds.has(id)) return [id];
    if (seen.has(id)) return [];
    const entry = archiveHistory.get(id); if (!entry) return [];
    return (entry.coveredEntryIds ?? []).flatMap(child => originalLeaves(child, new Set([...seen, id])));
  };
  const surviving = state.irminsul.entries.map(entry => {
    if (originalIds.has(entry.id)) return entry;
    const leaves = [...new Set((entry.coveredEntryIds ?? []).flatMap(id => originalLeaves(id)))];
    const rebased = { ...entry, coveredEntryIds: leaves };
    return leaves.length && hasVerifiedIrminsulCoverage(base.irminsul.entries, rebased) ? rebased : entry;
  });
  const coverageEvidence = [...base.irminsul.entries.filter(entry => !surviving.some(next => next.id === entry.id)), ...surviving];
  const preserved = base.irminsul.entries.filter(entry => !surviving.some(next => next.id === entry.id)
    && !surviving.some(upper => upper.coveredEntryIds?.includes(entry.id) && hasVerifiedIrminsulCoverage(coverageEvidence.filter(source => source.id !== upper.id), upper)));
  state = { ...state, irminsul: { entries: [...preserved, ...surviving] } };
  const baseItems = readMemorySourceItems(base); const nextItems = readMemorySourceItems(state);
  const patch: MemoryMaintenancePatch = {
    removed: baseItems.filter(item => !nextItems.some(next => next.id === item.id)),
    added: nextItems.filter(item => !baseItems.some(previous => previous.id === item.id)),
    archiveUpserts: state.irminsul.entries.filter(entry => !input.state.irminsul.entries.some(previous => previous.id === entry.id && same(previous, entry))),
    archiveRemoved: input.state.irminsul.entries.filter(entry => !state.irminsul.entries.some(next => next.id === entry.id)),
    archiveSources: input.state.irminsul.entries.filter(entry => archiveReads.has(entry.id)), failureUpserts: failures,
  };
  return { state, patch, failures, usedModel, usedLocal, usedFallback,
    ...(!batches ? { blockedReason: failures.length ? '模型总结失败，原层来源与失败材料已保留。' : (state.memory.失败草稿 ?? []).some(draft => draft.status === 'pending' || draft.status === 'retrying')
      ? '存在待重试来源；其余可处理来源未达阈值。' : '没有达到对应阈值的可处理完整批次。' } : {}) };
}
