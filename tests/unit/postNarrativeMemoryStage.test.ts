import { beforeEach, describe, expect, it, vi } from 'vitest';

import { settlePostNarrativeMemory } from '@/hooks/useGame/postNarrativeMemoryStage';
import { autoCompressMemorySystemWithArchivesAsync } from '@/hooks/useGame/memoryUtils';
import { 创建空记忆系统 } from '@/models/memory';
import { 创建默认记忆系统设置, type API配置项 } from '@/models/settings';
import { createEmptyIrminsulMemory } from '@/models/teyvat/irminsul';
import { getActiveIrminsulEntries } from '@/services/irminsulPromotion';

const compressionModel = vi.hoisted(() => ({ summarize: vi.fn() }));
vi.mock('@/services/memoryCompression', () => ({ summarizeMemoryBatch: compressionModel.summarize }));

describe('post-narrative memory stage', () => {
  beforeEach(() => compressionModel.summarize.mockReset());
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
});
