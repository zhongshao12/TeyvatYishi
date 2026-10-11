import { afterEach, describe, expect, it, vi } from 'vitest';
import { 创建空记忆系统 } from '@/models/memory';
import { 创建默认记忆系统设置, type API配置项 } from '@/models/settings';
import { addImmediateMemory, autoCompressMemorySystemWithArchivesAsync, retryMemoryFailureDraft } from '@/hooks/useGame/memoryUtils';
import { readMemoryLayerThresholds, runMemoryLayerCompression } from '@/services/memoryLayerCompression';
import { mergeMemoryMaintenancePatch } from '@/services/memoryMaintenanceMerge';
import { createEmptyTeyvatGameState, normalizeTeyvatGameState } from '@/models/teyvat/state';
import { toLegacyMemory, withLegacyMemory } from '@/hooks/useGameState';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import type { MemoryMaintenanceState } from '@/models/memorySource';
import type { MemoryCompressionSource } from '@/services/memoryCompression';

vi.mock('@/services/ai/apiErrorReportService', () => ({ appendApiErrorReport: vi.fn(async () => undefined) }));
const config: API配置项 = { id: 'test', name: 'test', provider: 'openai_compatible', baseUrl: 'https://example.invalid/v1', apiKey: 'test-key', model: 'test-model', createdAt: 1, updatedAt: 1 };
const settings = { ...创建默认记忆系统设置(), 即时转短期阈值: 2, 短期转中期阈值: 3, 中期转长期阈值: 4,
  记忆总结API: { ...创建默认记忆系统设置().记忆总结API, retryCount: 0 } };
function moment(turn: number): WorldMoment { return { worldName: '提瓦特', date: '旅行历 1000.03.05', clock: '09:30', weather: '晴',
  location: '蒙德城', travelDay: 5, turn, settlementId: `settlement-${turn}` }; }
function state(count: number, text?: string): MemoryMaintenanceState {
  let memory = 创建空记忆系统();
  for (let turn = 1; turn <= count; turn++) memory = addImmediateMemory(memory, text ?? `fact_${turn}`, turn, moment(turn));
  return { memory, irminsul: { entries: [] } };
}
afterEach(() => vi.unstubAllGlobals());

describe('shared memory promotion and failure protection', () => {
  it('does not fabricate provenance from invalid world-tree source turn values', () => {
    const tree = normalizeTeyvatGameState({ ...createEmptyTeyvatGameState(), 世界树: { entries: [{ id: 'old', title: 'old', summary: 'old', sourceText: 'old',
      sourceTurns: ['7', null, -1, 1.5, 2], keywords: [], recordedAt: '', archiveType: 'short', turn: 2 }] } });
    expect(tree.世界树.entries[0]?.sourceTurns).toEqual([2]);
  });
  it('records the actual new-turn identity even without a world moment, leaving its calendar unknown', () => {
    const first = addImmediateMemory(创建空记忆系统(), 'new event', 7);
    const id = first.即时记忆ID?.[0];
    expect(id).toBeTypeOf('string'); expect(first.来源回合?.[id!]).toEqual([7]);
    expect(first.来源时刻?.[id!]).toBeUndefined();
    expect(addImmediateMemory(first, 'new event', 7)).toBe(first);
  });
  it('does not return an unchanged normalized archive as a new delta solely due to field order', async () => {
    vi.stubGlobal('fetch', async () => new Response('unavailable', { status: 503 }));
    const original = { id: 'source', title: 'source', summary: '见安柏', sourceText: '见安柏\n获得信物', sourceTurns: [1],
      archiveType: 'short' as const, recordedAt: '', keywords: [], turn: 1 };
    const memory = { ...创建空记忆系统(), 短期记忆: [original.summary], 短期归档ID: [original.id] };
    const result = await autoCompressMemorySystemWithArchivesAsync(memory, 1, { ...settings, 短期转中期阈值: 1 }, config, undefined, { entries: [original] });
    expect(result.archives.some(entry => entry.id === original.id)).toBe(false);
  });
  it('reads independent thresholds and promotes 24 exact sources with 2/3/4 batches to one long memory', async () => {
    expect(readMemoryLayerThresholds(settings)).toEqual({ immediateToShort: 2, shortToMiddle: 3, middleToLong: 4 });
    const summarizer = vi.fn(async (source: MemoryCompressionSource) => ({ ok: true as const, summary: source.items.join('\n') }));
    const result = await runMemoryLayerCompression({ state: state(24), turn: 24, settings, summarizer, mode: 'automatic' });
    expect(result.state.memory.即时记忆).toHaveLength(0);
    expect(result.state.memory.短期记忆).toHaveLength(0);
    expect(result.state.memory.中期记忆).toHaveLength(0);
    expect(result.state.memory.长期记忆).toHaveLength(1);
    expect(summarizer).toHaveBeenCalledTimes(17);
    expect(summarizer.mock.calls.map(([source]) => [source.kind, source.prompt])).toEqual([
      ...Array.from({ length: 12 }, () => ['short', settings.即时转短期提示词]),
      ...Array.from({ length: 4 }, () => ['middle', settings.短期转中期提示词]), ['long', settings.中期转长期提示词],
    ]);
    const id = result.state.memory.长期归档ID?.[0];
    expect(result.state.memory.来源回合?.[id!]).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
    expect(result.state.irminsul.entries[0]?.sourceText).toContain('fact_24');
  });

  it('preserves every unarchived immediate source including the first of 51', () => {
    const memory = state(51).memory;
    expect(memory.即时记忆).toHaveLength(51);
    expect(memory.即时记忆[0]).toBe('fact_1');
    expect(memory.即时记忆ID?.[0]).toBe('memory_settlement-1_1');
    expect(memory.来源时刻?.['memory_settlement-1_1']?.start).toEqual(moment(1));
  });

  it('retains incomplete-batch balances and makes no request when there is no complete batch', async () => {
    const summarizer = vi.fn(async (source: { items: string[] }) => ({ ok: true as const, summary: source.items.join('\n') }));
    const single = await runMemoryLayerCompression({ state: state(1), turn: 1, settings, summarizer, mode: 'manual' });
    expect(summarizer).not.toHaveBeenCalled(); expect(single.blockedReason).toBeTruthy();
    const result = await runMemoryLayerCompression({ state: state(25), turn: 25, settings, summarizer, mode: 'automatic' });
    expect(result.state.memory.即时记忆).toEqual(['fact_25']); expect(result.state.memory.长期记忆).toHaveLength(1);
  });

  it('keeps original sources on API failure, excludes them next turn and distinguishes same-text identities', async () => {
    const fetch = vi.fn(async () => new Response('unavailable', { status: 503 })); vi.stubGlobal('fetch', fetch);
    const configSettings = { ...settings, 即时转短期阈值: 1, 短期转中期阈值: 1, 中期转长期阈值: 1 };
    const original = state(2, 'same').memory;
    const first = await autoCompressMemorySystemWithArchivesAsync(original, 2, configSettings, config);
    expect(first.memory.即时记忆).toEqual(original.即时记忆); expect(first.memory.短期记忆).toEqual([]);
    expect(first.failures).toHaveLength(2); expect(first.archives.every(entry => entry.status === 'pending')).toBe(true);
    expect(first.failures.map(draft => (draft as typeof draft & { sourceIds?: string[] }).sourceIds)).toEqual([
      ['memory_settlement-1_1'], ['memory_settlement-2_2'],
    ]);
    const next = await autoCompressMemorySystemWithArchivesAsync(first.memory, 3, configSettings, config, undefined, { entries: first.archives });
    expect(fetch).toHaveBeenCalledTimes(2); expect(next.memory.即时记忆).toEqual(original.即时记忆);
    const restored = toLegacyMemory(normalizeTeyvatGameState(JSON.parse(JSON.stringify(withLegacyMemory(createEmptyTeyvatGameState(), first.memory)))));
    expect((restored.失败草稿?.[0] as typeof first.failures[number] & { sourceIds?: string[] }).sourceIds).toEqual(['memory_settlement-1_1']);
  });

  it('retries exact retained sources and rejects changed sources before making another request', async () => {
    const fetch = vi.fn(async () => new Response('unavailable', { status: 503 })); vi.stubGlobal('fetch', fetch);
    const configSettings = { ...settings, 即时转短期阈值: 1, 短期转中期阈值: 99 };
    const failed = await autoCompressMemorySystemWithArchivesAsync(state(1).memory, 1, configSettings, config);
    const changed = { ...failed.memory, 即时记忆: ['player edit'] };
    const rejected = await retryMemoryFailureDraft(changed, failed.failures[0]!.id, configSettings, config, undefined, { entries: failed.archives });
    expect(rejected.draft.failureCode).toBe('source_changed'); expect(fetch).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: '- fact_1' } }] })));
    const retried = await retryMemoryFailureDraft(failed.memory, failed.failures[0]!.id, configSettings, config, undefined, { entries: failed.archives });
    expect(retried.draft.status).toBe('resolved'); expect(retried.memory.即时记忆).toEqual([]);
    expect(retried.memory.短期记忆[0]).toContain('fact_1');
  });

  it('does not call a model in local mode and preserves raw sources for later inspection', async () => {
    const summarizer = vi.fn(async () => ({ ok: true as const, summary: 'must not call' }));
    const result = await runMemoryLayerCompression({ state: state(2), turn: 2, settings: { ...settings, 启用中短长期API总结: false }, summarizer, mode: 'automatic' });
    expect(summarizer).not.toHaveBeenCalled(); expect(result.state.memory.短期记忆).toHaveLength(1);
    expect(result.state.irminsul.entries.some(entry => entry.sourceText.includes('fact_1') && entry.sourceText.includes('fact_2'))).toBe(true);
  });

  it('combines bound and world-tree-only sources once and excludes pending, refined and unknown sources', async () => {
    const entry = (id: string, turn: number) => ({ id, title: id, summary: `摘要${id}`, sourceText: `原文${id}`, sourceTurns: [turn],
      keywords: [], recordedAt: '', archiveType: 'short' as const, turn });
    const a = entry('a', 1); const b = entry('b', 2);
    const pending = { ...entry('p', 3), status: 'pending' as const };
    const refined = { ...entry('r', 4), archiveType: 'refined' as const };
    const unknown = { ...entry('unknown', 5), sourceTurns: [] };
    const initial: MemoryMaintenanceState = { memory: { ...创建空记忆系统(), 短期记忆: [a.summary], 短期归档ID: [a.id] },
      irminsul: { entries: [a, b, pending, refined, unknown] } };
    const summarizer = vi.fn(async (source: { items: string[] }) => ({ ok: true as const, summary: source.items.join('\n') }));
    const result = await runMemoryLayerCompression({ state: initial, turn: 5, settings: { ...settings, 短期转中期阈值: 2 }, summarizer, mode: 'irminsul' });
    expect(summarizer).toHaveBeenCalledTimes(1); expect(result.state.memory.短期记忆).toEqual([]);
    expect(result.state.memory.中期记忆).toHaveLength(1);
    expect(result.state.irminsul.entries.some(item => item.id === pending.id)).toBe(true);
    expect(result.state.irminsul.entries.some(item => item.id === refined.id)).toBe(true);
    expect(result.state.irminsul.entries.some(item => item.id === unknown.id)).toBe(true);
    expect(result.patch.archiveSources?.map(item => item.id)).toEqual(['a', 'b']);
    const merged = mergeMemoryMaintenancePatch(initial, initial, result.patch);
    expect(merged.ok).toBe(true);
    if (merged.ok) expect(merged.state.memory.中期记忆).toEqual(result.state.memory.中期记忆);
  });

  it('retries a world-tree-only failed batch without adding array memories or consuming unrelated archives', async () => {
    const entry = (id: string, turn: number) => ({ id, title: id, summary: `摘要${id}`, sourceText: `原文${id}`, sourceTurns: [turn],
      keywords: [], recordedAt: '', archiveType: 'short' as const, turn });
    const original: MemoryMaintenanceState = { memory: 创建空记忆系统(), irminsul: { entries: [entry('a', 1), entry('b', 2)] } };
    const failed = await runMemoryLayerCompression({ state: original, turn: 2, settings: { ...settings, 短期转中期阈值: 2 }, mode: 'irminsul',
      summarizer: async () => ({ ok: false as const, code: 'request_failed', message: '503' }) });
    expect(failed.state.memory.短期记忆).toEqual([]);
    const unrelated = entry('c', 3);
    const tree = { entries: [...failed.state.irminsul.entries, unrelated] };
    const fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: '- 原文a\n- 原文b' } }] })); vi.stubGlobal('fetch', fetch);
    const retried = await retryMemoryFailureDraft(failed.state.memory, failed.failures[0]!.id, settings, config, undefined, tree);
    expect(retried.draft.status).toBe('resolved');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(retried.memory.中期记忆).toEqual([]);
    expect(retried.irminsul?.entries.find(item => item.id === 'c')).toEqual(unrelated);
    expect(retried.irminsul?.entries.some(item => item.archiveType === 'medium' && item.status === 'active' && item.summary.includes('原文b'))).toBe(true);
    const changed = { entries: tree.entries.map(item => item.id === 'a' ? { ...item, sourceText: 'player edit' } : item) };
    const rejected = await retryMemoryFailureDraft(failed.state.memory, failed.failures[0]!.id, settings, config, undefined, changed);
    expect(rejected.draft.failureCode).toBe('source_changed'); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('discards a late successful result after cancellation without changing the input', async () => {
    const original = state(2); const snapshot = JSON.stringify(original); const controller = new AbortController();
    const result = runMemoryLayerCompression({ state: original, turn: 2, settings, mode: 'manual', signal: controller.signal,
      summarizer: async source => { controller.abort(); return { ok: true as const, summary: source.items.join('\n') }; } });
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('keeps deletion proof valid when bound archives promote through multiple layers in one run', async () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, title: 'source', summary: `fact_${i}`, sourceText: `fact_${i}`,
      sourceTurns: [i + 1], keywords: [], recordedAt: '', archiveType: 'short' as const, turn: i + 1 }));
    const original: MemoryMaintenanceState = { memory: { ...创建空记忆系统(), 短期记忆: entries.map(e => e.summary), 短期归档ID: entries.map(e => e.id) }, irminsul: { entries } };
    const result = await runMemoryLayerCompression({ state: original, turn: 12, settings, mode: 'manual',
      summarizer: async source => ({ ok: true as const, summary: source.items.join('\n') }) });
    const merged = mergeMemoryMaintenancePatch(original, original, result.patch);
    expect(merged.ok).toBe(true);
    if (merged.ok) { expect(merged.state.memory.长期记忆).toHaveLength(1); expect(merged.state.irminsul.entries.some(e => e.sourceText.includes('fact_11'))).toBe(true); }
  });
});
