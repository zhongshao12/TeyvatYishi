import { afterEach, describe, expect, it, vi } from 'vitest';
import { 创建空记忆系统 } from '@/models/memory';
import { 创建默认记忆系统设置, type API配置项 } from '@/models/settings';
import { autoCompressMemorySystemWithArchivesAsync, retryMemoryFailureDraft } from '@/hooks/useGame/memoryUtils';
import { summarizeMemoryBatch } from '@/services/memoryCompression';
import { promoteIrminsulEntry } from '@/services/irminsulPromotion';
import type { IrminsulEntry, IrminsulMemory } from '@/models/teyvat/irminsul';

vi.mock('@/services/ai/apiErrorReportService', () => ({ appendApiErrorReport: vi.fn(async () => undefined) }));
const config = { id: 'test', name: 'test', provider: 'openai_compatible', baseUrl: 'https://example.invalid/v1', apiKey: 'test-key',
  model: 'test-model', createdAt: 1, updatedAt: 1 } satisfies API配置项;
const localSettings = { ...创建默认记忆系统设置(), 启用中短长期API总结: false };
const fact = (turn: number) => `事件_${turn}：承诺归还信件_${turn}；获得道具_${turn}；完成节点_${turn}。`;
afterEach(() => vi.unstubAllGlobals());

describe('memory source fact coverage', () => {
  it('retains the result of every one of 15 local memories, including results after long player inputs', async () => {
    const items = Array.from({ length: 15 }, (_, i) => `玩家输入：${'长输入'.repeat(80)}\n剧情回应：${fact(i + 1)}`);
    const result = await summarizeMemoryBatch({ kind: 'short', turn: 15, items, prompt: '' }, localSettings, config);
    for (let turn = 1; turn <= 15; turn++) expect(result.summary).toContain(fact(turn));
  });

  it('preserves all 225 turn facts through local short-to-medium promotion', async () => {
    let memory = 创建空记忆系统();
    let tree: IrminsulMemory = { entries: [] };
    for (let turn = 1; turn <= 225; turn++) {
      memory = { ...memory, 即时记忆: [...memory.即时记忆, fact(turn)] };
      const result = await autoCompressMemorySystemWithArchivesAsync(memory, turn, localSettings, config, undefined, tree);
      memory = result.memory;
      for (const archive of result.archives) tree = promoteIrminsulEntry(tree, archive);
    }
    const retained = [...memory.即时记忆, ...memory.短期记忆, ...(memory.中期记忆 ?? []), ...memory.长期记忆,
      ...tree.entries.map((entry) => `${entry.summary}\n${entry.sourceText}`)].join('\n');
    for (let turn = 1; turn <= 225; turn++) expect(retained).toContain(fact(turn));
    expect(memory.中期记忆?.[0]?.length).toBeLessThan(2500);
  });

  it('does not retire a source when IDs and turns match but its actual result is omitted', () => {
    const source: IrminsulEntry = { id: 'source', title: 'source', summary: '见安柏', sourceText: '见安柏\n获得信物；承诺送达信件',
      sourceTurns: [1], archiveType: 'short', recordedAt: '', keywords: [], turn: 1 };
    const upper: IrminsulEntry = { ...source, id: 'upper', archiveType: 'medium', sourceText: '见安柏', coveredEntryIds: ['source'] };
    expect(promoteIrminsulEntry({ entries: [source] }, upper).entries.map((item) => item.id)).toEqual(['source', 'upper']);
  });

  it('gives each different failed archive its own retry despite identical source material', async () => {
    const settings = { ...创建默认记忆系统设置(), 记忆总结API: { ...创建默认记忆系统设置().记忆总结API, retryCount: 0 } };
    vi.stubGlobal('fetch', async () => new Response('unavailable', { status: 503 }));
    const failed = await autoCompressMemorySystemWithArchivesAsync({ ...创建空记忆系统(), 即时记忆: Array(30).fill('相同材料') },
      30, settings, config);
    expect(failed.failures).toHaveLength(2);
    expect(new Set(failed.failures.map((draft) => draft.archiveEntryId)).size).toBe(2);
    let tree: IrminsulMemory = { entries: failed.archives };
    let memory = failed.memory;
    vi.stubGlobal('fetch', async () => Response.json({ choices: [{ message: { content: '- 相同材料' } }] }));
    for (const draft of failed.failures) {
      const result = await retryMemoryFailureDraft(memory, draft.id, settings, config, undefined, tree);
      expect(result.draft.status).toBe('resolved');
      memory = result.memory;
      tree = result.irminsul ?? tree;
    }
    expect(tree.entries.every((entry) => entry.status === 'active')).toBe(true);
    expect(memory.失败草稿?.every((draft) => draft.status === 'resolved')).toBe(true);
  });

  it('keeps an incompletely covered source after API retry and removes the active complete-coverage claim', async () => {
    const source: IrminsulEntry = { id: 'source', title: 'source', summary: '见安柏', sourceText: '见安柏\n获得信物；承诺送达信件',
      sourceTurns: [1], archiveType: 'short', recordedAt: '', keywords: [], turn: 1 };
    const defaults = 创建默认记忆系统设置();
    const settings = { ...defaults, 短期转中期阈值: 1, 记忆总结API: { ...defaults.记忆总结API, retryCount: 0 } };
    vi.stubGlobal('fetch', async () => new Response('unavailable', { status: 503 }));
    const failed = await autoCompressMemorySystemWithArchivesAsync({ ...创建空记忆系统(), 短期记忆: [source.summary], 短期归档ID: [source.id] },
      1, settings, config, undefined, { entries: [source] });
    vi.stubGlobal('fetch', async () => Response.json({ choices: [{ message: { content: '- 见安柏' } }] }));
    const retried = await retryMemoryFailureDraft(failed.memory, failed.failures[0]!.id, settings, config, undefined,
      { entries: [source, ...failed.archives] });
    expect(retried.irminsul?.entries.some((entry) => entry.id === source.id)).toBe(true);
    expect(retried.irminsul?.entries.find((entry) => entry.id === failed.archives[0]?.id)?.coveredEntryIds).toBeUndefined();
  });
});
