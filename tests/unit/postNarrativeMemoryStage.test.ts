import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rebasePostNarrativeMemorySettlement, settlePostNarrativeMemory } from '@/hooks/useGame/postNarrativeMemoryStage';
import { autoCompressMemorySystemWithArchivesAsync, retryMemoryFailureDraft } from '@/hooks/useGame/memoryUtils';
import { 创建空记忆系统, serializeMemoryFailureSource } from '@/models/memory';
import { 创建默认记忆系统设置, type API配置项 } from '@/models/settings';
import { createEmptyIrminsulMemory } from '@/models/teyvat/irminsul';
import { getActiveIrminsulEntries } from '@/services/irminsulPromotion';
import { captureWorldMoment } from '@/services/worldMoment';
import { createEmptyTeyvatGameState } from '@/models/teyvat';

const compressionModel = vi.hoisted(() => ({ summarize: vi.fn() }));
vi.mock('@/services/memoryCompression', () => ({ summarizeMemoryBatch: compressionModel.summarize }));

describe('post-narrative memory stage', () => {
  beforeEach(() => compressionModel.summarize.mockReset());
  it('preserves edits made while compression awaited and still records the settled turn', () => {
    const base = 创建空记忆系统();
    const live = { ...base, 即时记忆: ['玩家手动补记'] };
    const compressed = { ...base, 短期记忆: ['旧记忆的压缩结果'] };
    const moment = captureWorldMoment({ ...createEmptyTeyvatGameState().世界, 当前时间: '14:00' }, 8, 'settled-8');
    const result = rebasePostNarrativeMemorySettlement({
      baseMemory: base, liveMemory: live, compressedMemory: compressed,
      baseIrminsul: createEmptyIrminsulMemory(),
      liveIrminsul: { entries: [{ id: 'player-edit', title: '手记', summary: '玩家补记', sourceText: '', keywords: [], sourceTurns: [8], turn: 8, recordedAt: '8', archiveType: 'short' }] },
      compressedIrminsul: { entries: [{ id: 'stale-compression', title: '旧压缩', summary: '旧', sourceText: '', keywords: [], sourceTurns: [8], turn: 8, recordedAt: '8', archiveType: 'short' }] },
      userInput: '与安柏交谈', narrativeSummary: '', body: '安柏回应。', moment,
    });
    expect(result.memory.即时记忆).toContain('玩家手动补记');
    expect(result.memory.即时记忆.some((item) => item.includes('安柏回应'))).toBe(true);
    expect(result.memory.来源时刻?.['memory_settled-8_8']?.start?.clock).toBe('14:00');
    expect(result.irminsul.entries.map((entry) => entry.id)).toEqual(['player-edit']);
  });
  it('adds immediate memory, archives compression output, and reports model success', async () => {
    const result = await settlePostNarrativeMemory({
      memory: 创建空记忆系统(),
      irminsul: createEmptyIrminsulMemory(),
      userInput: '去找安柏。',
      narrativeSummary: '旅行者抵达蒙德城门。',
      body: '【旁白】安柏在城门前挥手。',
      turn: 6,
      settings: 创建默认记忆系统设置(),
      mainConfig: {} as API配置项,
      compress: async (memory) => ({
        memory,
        archives: [{
          id: 'archive-6',
          title: '第六回纪要',
          archiveType: 'short',
          summary: '安柏在城门迎接旅行者。',
          sourceText: '城门相遇',
          keywords: ['安柏', '蒙德'],
          sourceTurns: [6],
          turn: 6,
          recordedAt: '第6回',
        }],
        failures: [],
        usedFallback: false,
        usedModel: true,
        usedLocal: false,
      }),
    });

    expect(result.memory.即时记忆[0]).toContain('玩家输入：去找安柏。');
    expect(result.memory.即时记忆[0]).toContain('本回合小结：旅行者抵达蒙德城门。');
    expect(result.irminsul.entries.map((entry) => entry.id)).toEqual(['archive-6']);
    expect(result.feedback.status).toBe('success');
    expect(result.feedback.detail).toContain('记忆总结 API');
  });

  it('commits archive promotion without retaining covered sources or losing unrelated live entries', async () => {
    compressionModel.summarize.mockResolvedValue({ summary: '安柏完成侦察', usedFallback: false, usedModel: true, usedLocal: false });
    const source = { id: 'source-short', title: '侦察', summary: '安柏带队侦察', sourceText: '侦察原文', keywords: ['安柏'],
      sourceTurns: [5], recordedAt: '第5回', archiveType: 'short' as const, turn: 5 };
    const unrelated = { ...source, id: 'player-note', summary: '等待时玩家补充的手记' };
    const baseMemory = { ...创建空记忆系统(), 短期记忆: [source.summary], 短期归档ID: [source.id] };
    const baseIrminsul = { entries: [source] };
    const worldMoment = captureWorldMoment(createEmptyTeyvatGameState().世界, 6, 'turn-6');
    const compressed = await settlePostNarrativeMemory({
      memory: baseMemory, irminsul: baseIrminsul,
      userInput: '继续侦察', narrativeSummary: '', body: '安柏完成侦察。', turn: 6, moment: worldMoment,
      settings: { ...创建默认记忆系统设置(), 即时转短期阈值: 9, 短期转中期阈值: 1, 中期转长期阈值: 9 },
      mainConfig: {} as API配置项,
    });
    const committed = rebasePostNarrativeMemorySettlement({
      baseMemory, liveMemory: structuredClone(baseMemory), compressedMemory: compressed.memory,
      baseIrminsul, liveIrminsul: { entries: [source, unrelated] }, compressedIrminsul: compressed.irminsul,
      userInput: '继续侦察', narrativeSummary: '', body: '安柏完成侦察。', moment: worldMoment,
    });
    expect(committed.compressionDeferred).toBe(false);
    expect(committed.irminsul.entries.some((entry) => entry.id === source.id)).toBe(false);
    expect(committed.irminsul.entries.find((entry) => entry.id === unrelated.id)?.summary).toBe('等待时玩家补充的手记');
    expect(getActiveIrminsulEntries(committed.irminsul).map((entry) => entry.archiveType)).toEqual(['short', 'medium']);
  });

  it.each(['edit', 'delete'] as const)('defers stale compression when a covered source was concurrently %s', (action) => {
    const source = { id: 'source-short', title: '侦察', summary: '安柏带队侦察', sourceText: '原文', keywords: ['安柏'],
      sourceTurns: [5], recordedAt: '第5回', archiveType: 'short' as const, turn: 5 };
    const summary = { ...source, id: 'summary-middle', archiveType: 'medium' as const, coveredEntryIds: [source.id] };
    const baseMemory = { ...创建空记忆系统(), 短期记忆: [source.summary], 短期归档ID: [source.id] };
    const liveIrminsul = { entries: action === 'edit' ? [{ ...source, summary: '玩家纠正过的记忆' }] : [] };
    const result = rebasePostNarrativeMemorySettlement({
      baseMemory, liveMemory: structuredClone(baseMemory),
      compressedMemory: { ...创建空记忆系统(), 中期记忆: [summary.summary], 中期归档ID: [summary.id] },
      baseIrminsul: { entries: [source] }, liveIrminsul, compressedIrminsul: { entries: [summary] },
      userInput: '继续', narrativeSummary: '', body: '安柏回应。',
      moment: captureWorldMoment(createEmptyTeyvatGameState().世界, 6, 'turn-6'),
    });
    expect(result.compressionDeferred).toBe(true);
    expect(result.irminsul).toBe(liveIrminsul);
    expect(result.memory.短期记忆).toEqual(['安柏带队侦察']);
    expect(result.memory.中期记忆).toEqual([]);
    expect(result.memory.即时记忆.some((item) => item.includes('安柏回应'))).toBe(true);
  });

  it('preserves the memory result and exposes retry feedback when compression fails', async () => {
    const result = await settlePostNarrativeMemory({
      memory: 创建空记忆系统(),
      irminsul: createEmptyIrminsulMemory(),
      userInput: '继续。',
      narrativeSummary: '',
      body: '【旁白】旅途继续。',
      turn: 7,
      settings: 创建默认记忆系统设置(),
      mainConfig: {} as API配置项,
      compress: async (memory) => ({
        memory,
        archives: [],
        failures: [{ id: 'failed-draft' }] as never[],
        usedFallback: true,
        usedModel: false,
        usedLocal: true,
      }),
    });

    expect(result.memory.即时记忆[0]).toContain('剧情回应：【旁白】旅途继续。');
    expect(result.feedback.status).toBe('failed');
    expect(result.feedback.failCount).toBe(1);
    expect(result.feedback.retryHint).toContain('失败草稿');
  });

  it('compresses_across_layers_without_duplicate_recall', async () => {
    compressionModel.summarize.mockResolvedValue({ summary: '- 安柏带队抵达蒙德', usedFallback: false, usedModel: true, usedLocal: false });
    const settings = { ...创建默认记忆系统设置(), 即时转短期阈值: 1, 短期转中期阈值: 1, 中期转长期阈值: 1 };
    const result = await settlePostNarrativeMemory({
      memory: 创建空记忆系统(), irminsul: createEmptyIrminsulMemory(),
      userInput: '找安柏', narrativeSummary: '抵达蒙德', body: '安柏挥手。', turn: 6,
      settings, mainConfig: {} as API配置项,
    });
    expect(compressionModel.summarize).toHaveBeenCalledTimes(3);
    expect(getActiveIrminsulEntries(result.irminsul).map((entry) => entry.archiveType)).toEqual(['long']);
    expect(result.irminsul.entries).toHaveLength(1);
    expect(result.irminsul.entries[0]?.sourceTurns).toEqual([6]);
    const repeated = await autoCompressMemorySystemWithArchivesAsync(result.memory, 6, settings, {} as API配置项, undefined, result.irminsul);
    expect(repeated.archives).toEqual([]);
    const replayed = await settlePostNarrativeMemory({
      memory: 创建空记忆系统(), irminsul: result.irminsul,
      userInput: '找安柏', narrativeSummary: '抵达蒙德', body: '安柏挥手。', turn: 6,
      settings, mainConfig: {} as API配置项,
    });
    expect(replayed.irminsul.entries).toHaveLength(1);

    const shortA = { ...result.irminsul.entries[0]!, id: 'short-a', archiveType: 'short' as const, sourceTurns: [3] };
    const shortB = { ...shortA, id: 'short-b', sourceTurns: [4] };
    const ambiguous = await autoCompressMemorySystemWithArchivesAsync({ ...创建空记忆系统(), 短期记忆: [shortA.summary] }, 7,
      { ...settings, 即时转短期阈值: 9, 中期转长期阈值: 9 }, {} as API配置项, undefined, { entries: [shortA, shortB] });
    expect(ambiguous.archives[0]?.coveredEntryIds).toBeUndefined();
    const oldUnique = await autoCompressMemorySystemWithArchivesAsync({ ...创建空记忆系统(), 短期记忆: [shortA.summary] }, 7,
      { ...settings, 即时转短期阈值: 9, 中期转长期阈值: 9 }, {} as API配置项, undefined, { entries: [shortA] });
    expect(oldUnique.archives[0]?.coveredEntryIds).toBeUndefined();
  });

  it('failed_fallback_keeps_source and retry anchor', async () => {
    compressionModel.summarize.mockResolvedValue({ summary: '本地回退摘要', usedFallback: true, usedModel: false,
      usedLocal: false, failureCode: 'request_failed', failureMessage: '暂时失败' });
    const source = { id: 'source-short', title: '短期记忆', summary: '安柏迎接玩家', sourceText: '原文', keywords: ['安柏'],
      sourceTurns: [5], recordedAt: '第5回', archiveType: 'short' as const, turn: 5 };
    const settings = { ...创建默认记忆系统设置(), 即时转短期阈值: 9, 短期转中期阈值: 1, 中期转长期阈值: 9 };
    const result = await settlePostNarrativeMemory({
      memory: { ...创建空记忆系统(), 短期记忆: [source.summary], 短期归档ID: ['source-short'] }, irminsul: { entries: [source] },
      userInput: '继续', narrativeSummary: '', body: '继续探索。', turn: 6,
      settings, mainConfig: {} as API配置项,
    });
    expect(result.irminsul.entries.map((entry) => entry.id)).toContain('source-short');
    expect(getActiveIrminsulEntries(result.irminsul).map((entry) => entry.id)).toEqual(['source-short']);
    const pending = result.irminsul.entries.find((entry) => entry.status === 'pending');
    expect(pending?.coveredEntryIds).toEqual(['source-short']);
    expect(result.memory.失败草稿?.[0]?.archiveEntryId).toBe(pending?.id);
    const repeated = await autoCompressMemorySystemWithArchivesAsync(result.memory, 6, settings, {} as API配置项, undefined, result.irminsul);
    expect(repeated.archives).toEqual([]);

    compressionModel.summarize.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    const before = structuredClone(result.irminsul);
    await expect(autoCompressMemorySystemWithArchivesAsync({ ...创建空记忆系统(), 短期记忆: ['另一个短期'] }, 7,
      settings, {} as API配置项, undefined, result.irminsul)).rejects.toMatchObject({ name: 'AbortError' });
    expect(result.irminsul).toEqual(before);
  });

  it('retry_replaces_only_its_pending_archive', async () => {
    const snapshot = await serializeMemoryFailureSource(['安柏迎接玩家']);
    const source = { id: 'source-short', title: '短期记忆', summary: '安柏迎接玩家', sourceText: '原文', keywords: ['安柏'],
      sourceTurns: [5], recordedAt: '第5回', archiveType: 'short' as const, turn: 5 };
    const pending = { ...source, id: 'pending-middle', archiveType: 'medium' as const, summary: '本地回退摘要',
      coveredEntryIds: ['source-short'], status: 'pending' as const };
    const otherPending = { ...pending, id: 'other-pending', summary: '另一份待重试摘要', coveredEntryIds: undefined };
    const tree = { entries: [source, pending, otherPending] };
    const draft = { id: 'draft-middle', archiveEntryId: pending.id, kind: 'middle' as const, status: 'pending' as const,
      sourceTurns: { start: 5, end: 5 }, sourceSnapshot: snapshot, targetLayer: '中期记忆' as const,
      fallbackSummary: pending.summary, failureCode: 'request_failed' as const, failureMessage: '暂时失败',
      attemptCount: 0, createdAt: 1, updatedAt: 1 };
    const memory = { ...创建空记忆系统(), 中期记忆: [pending.summary, pending.summary],
      中期归档ID: [otherPending.id, pending.id], 失败草稿: [draft] };
    const settings = 创建默认记忆系统设置();
    compressionModel.summarize.mockResolvedValue({ summary: '安柏带队完成侦察', usedFallback: false, usedModel: true, usedLocal: false });

    const retried = await retryMemoryFailureDraft(memory, draft.id, settings, {} as API配置项, undefined, tree);
    expect(retried.memory.中期记忆).toEqual([pending.summary, '安柏带队完成侦察']);
    expect(retried.draft.status).toBe('resolved');
    expect(retried.draft.sourceSnapshot.payload).toBe('');
    expect(retried.irminsul?.entries.map((entry) => entry.id)).toEqual(['other-pending', 'pending-middle']);
    expect(retried.irminsul?.entries.find((entry) => entry.id === pending.id)).toMatchObject({
      summary: '安柏带队完成侦察', status: 'active', coveredEntryIds: ['source-short'],
    });
    const repeated = await retryMemoryFailureDraft(retried.memory, draft.id, settings, {} as API配置项, undefined, retried.irminsul);
    expect(repeated.irminsul).toBe(retried.irminsul);
    expect(compressionModel.summarize).toHaveBeenCalledTimes(1);

    const changed = await retryMemoryFailureDraft({ ...memory, 中期记忆: [pending.summary, '人工修改的摘要'] }, draft.id,
      settings, {} as API配置项, undefined, tree);
    expect(changed.draft.failureCode).toBe('source_changed');
    expect(changed.irminsul).toBe(tree);
  });
});
