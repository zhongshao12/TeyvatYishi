import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRebuildTask, extractMemoryRebuildTurns, runMemoryRebuildTask, type MemoryRebuildTask } from '@/services/memoryRebuild';
import type { 聊天消息 } from '@/models/chat';
import type { MemorySourceItem } from '@/models/memorySource';
import type { IrminsulMemory } from '@/models/teyvat/irminsul';
import type { WorldMoment } from '@/models/teyvat/worldMoment';
import { summarizeMemoryBatch } from '@/services/memoryCompression';
import { 创建默认记忆系统设置 } from '@/models/settings';

const settings = { apiEnabled: true, thresholds: { immediateToShort: 2, shortToMiddle: 50, middleToLong: 50 } };
const future = (task: MemoryRebuildTask) => task as MemoryRebuildTask & {
  nextTurnIndex: number; turnSummaries: MemorySourceItem[]; stagedIrminsul: IrminsulMemory;
  phase: 'turns' | 'compression' | 'ready';
};
function history(count: number): 聊天消息[] {
  return Array.from({ length: count }, (_, index) => {
    const turn = index + 1;
    return [
      { id: `u${turn}`, role: 'user' as const, content: `要求_${turn}`, timestamp: turn * 2, gameTime: String(turn) },
      { id: `a${turn}`, role: 'assistant' as const, content: `结果_${turn}；承诺_${turn}；物品_${turn}`, timestamp: turn * 2 + 1, gameTime: String(turn) },
    ];
  }).flat();
}
afterEach(() => vi.unstubAllGlobals());

describe('per-turn resumable memory rebuild', () => {
  it('keeps distinct users with duplicate turn numbers ambiguous instead of fabricating a reroll pair', () => {
    const duplicate = [...history(1), ...history(1).map(message => ({ ...message, id: `${message.id}-second`, content: `second-${message.content}` }))];
    const extracted = extractMemoryRebuildTurns(duplicate);
    expect(extracted.turns).toEqual([]);
    expect(extracted.warnings.join('\n')).toMatch(/重复回合|多个玩家输入/);
  });

  it('does not treat a reply after another user segment as a reroll of an earlier turn', () => {
    const raw = history(2);
    const extracted = extractMemoryRebuildTurns([...raw, { ...raw[1]!, id: 'late-a1', content: '迟到旧回复' }]);
    expect(extracted.turns[0]?.assistantId).toBe('a1');
    expect(extracted.turns[0]?.body).not.toContain('迟到');
  });

  it.each([15, 30])('summarizes each of 15 turns independently with progress grouping %i', async batchSize => {
    const task = future(createMemoryRebuildTask({ chatHistory: history(15), batchSize }));
    const calls: Array<{ kind: string; items: string[]; turn: number }> = [];
    const progress: number[] = [];
    await runMemoryRebuildTask(task, { settings, onProgress: p => progress.push(p.processedTurns),
      summarizer: async source => { calls.push(source); return { ok: true, summary: `独立摘要_${source.turn}` }; } });
    expect(calls).toHaveLength(15);
    expect(calls[0]?.items).toEqual(['【第 1 回合】\n玩家输入：要求_1\n正文：结果_1；承诺_1；物品_1']);
    expect(calls[14]?.items).toEqual(['【第 15 回合】\n玩家输入：要求_15\n正文：结果_15；承诺_15；物品_15']);
    expect(calls.every(call => call.kind === 'short' && call.items.length === 1)).toBe(true);
    expect(task.turnSummaries?.length).toBe(15);
    expect(task.staging.短期记忆).toHaveLength(15);
    expect(task.turnSummaries?.[14]?.sourceTurns).toEqual([15]);
    expect(task.turnSummaries?.[14]?.sourceMessageIds).toEqual(['u15', 'a15']);
    expect(task.turnSummaries?.[14]?.momentRange?.start).toBeNull();
    expect(task.stagedIrminsul?.entries.some(e => e.archiveType === 'refined' && e.sourceText.includes('物品_15'))).toBe(true);
    expect(new Set(progress)).toEqual(new Set(Array.from({ length: 16 }, (_, i) => i)));
    expect(task.status).toBe('ready');
  });

  it('resumes at failed turn 8 without requesting successful turns 1–7 again', async () => {
    const task = future(createMemoryRebuildTask({ chatHistory: history(15), batchSize: 15 }));
    const requested: number[] = []; let failed = false;
    const summarizer = async (source: { turn: number }) => {
      requested.push(source.turn);
      if (source.turn === 8 && !failed) { failed = true; return { ok: false as const, code: 'request_failed', message: '503' }; }
      return { ok: true as const, summary: `摘要_${source.turn}` };
    };
    await runMemoryRebuildTask(task, { settings, summarizer });
    expect(task.status).toBe('paused_failed');
    expect(task.nextTurnIndex).toBe(7);
    expect(task.progress.processedTurns).toBe(7);
    expect(task.failedBatch?.items).toEqual(['【第 8 回合】\n玩家输入：要求_8\n正文：结果_8；承诺_8；物品_8']);
    await runMemoryRebuildTask(task, { settings, summarizer });
    expect(requested).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(task.status).toBe('ready'); expect(task.staging.短期记忆).toHaveLength(15);
  });

  it('resumes failed promotion with independent layer thresholds without redoing per-turn summaries', async () => {
    const task = future(createMemoryRebuildTask({ chatHistory: history(12), batchSize: 15 }));
    const kinds: string[] = []; let failed = false;
    const tierSettings = { ...settings, thresholds: { immediateToShort: 99, shortToMiddle: 3, middleToLong: 4 } };
    const summarizer = async (source: { kind: string; items: string[] }) => {
      kinds.push(source.kind);
      if (source.kind === 'middle' && !failed) { failed = true; return { ok: false as const, message: '503' }; }
      return { ok: true as const, summary: source.items.join('\n') };
    };
    await runMemoryRebuildTask(task, { settings: tierSettings, summarizer });
    expect(task.status).toBe('paused_failed'); expect(task.phase).toBe('compression');
    expect(task.turnSummaries?.length).toBe(12);
    await runMemoryRebuildTask(task, { settings: tierSettings, summarizer });
    expect(task.status).toBe('ready');
    expect(kinds.filter(k => k === 'short')).toHaveLength(12);
    expect(kinds.filter(k => k === 'middle')).toHaveLength(5);
    expect(kinds.filter(k => k === 'long')).toHaveLength(1);
    expect(task.staging.长期记忆).toHaveLength(1);
  });

  it('uses the latest valid reroll, excluding streaming and empty failed bodies', () => {
    const original = history(1);
    const valid: 聊天消息 = { ...original[1]!, id: 'new', content: '有效重掷' };
    const streaming = { ...valid, id: 'stream', content: '未完成', isStreaming: true };
    const failed = { ...valid, id: 'failed', content: '失败', parsedResponse: { body: [], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } } };
    const extracted = extractMemoryRebuildTurns([...original, valid, streaming, failed]);
    expect(extracted.turns[0]?.assistantId).toBe('new'); expect(extracted.turns[0]?.body).toBe('有效重掷');
  });

  it('lists missing turns and excludes unlocated or duplicate-ID pairs rather than fabricating provenance', () => {
    const raw = history(8).filter(message => !(message.role === 'assistant' && ['4', '7'].includes(message.gameTime!)));
    const task = createMemoryRebuildTask({ chatHistory: raw, batchSize: 15, range: { start: 1, end: 8 } });
    expect(task.turns.map(t => t.turn)).toEqual([1, 2, 3, 5, 6, 8]);
    expect(task.warnings.join('\n')).toMatch(/缺失.*4.*7/);
    const unknown = history(1).map(message => ({ ...message, gameTime: undefined }));
    expect(extractMemoryRebuildTurns(unknown).turns).toEqual([]);
    expect(extractMemoryRebuildTurns([...history(1), { ...history(1)[1]!, content: '重复ID' }]).turns).toEqual([]);
  });

  it('does not mark ready or store the final late summary when cancellation arrives with the response', async () => {
    const task = future(createMemoryRebuildTask({ chatHistory: history(1), batchSize: 15 })); const controller = new AbortController();
    await runMemoryRebuildTask(task, { settings, signal: controller.signal, summarizer: async () => {
      controller.abort(); return { ok: true, summary: '迟到摘要' };
    } });
    expect(task.status).toBe('cancelled'); expect(task.progress.processedTurns).toBe(0); expect(task.staging.短期记忆).toEqual([]);
  });

  it('retains all nine model summary lines instead of silently dropping later facts', async () => {
    let systemPrompt = '';
    vi.stubGlobal('fetch', async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)); systemPrompt = body.messages[0].content;
      return Response.json({ choices: [{ message: { content: Array.from({ length: 9 }, (_, i) => `- 事实_${i + 1}`).join('\n') } }] });
    });
    const result = await summarizeMemoryBatch({ kind: 'short', turn: 1, items: ['本回合有九个不同的事实'], prompt: '逐回合保留关键结果' },
      { ...创建默认记忆系统设置(), 记忆总结API: { ...创建默认记忆系统设置().记忆总结API, retryCount: 0 } },
      { id: 'test', name: 'test', provider: 'openai_compatible', baseUrl: 'https://example.invalid/v1', apiKey: 'test', model: 'test', createdAt: 1, updatedAt: 1 });
    expect(result.summary).toContain('事实_9'); expect(result.summary.split('\n')).toHaveLength(9);
    expect(systemPrompt).not.toContain('只输出 3-6 条');
  });

  it('does not repeat successful middle promotions before a later failed promotion', async () => {
    const task = createMemoryRebuildTask({ chatHistory: history(6), batchSize: 15 });
    const requests: number[] = []; let failed = false;
    const summarizer = async (source: { kind: string; sourceTurns?: { start: number; end: number }; items: string[] }) => {
      if (source.kind === 'middle') {
        requests.push(source.sourceTurns!.start);
        if (source.sourceTurns!.start === 3 && !failed) { failed = true; return { ok: false as const, message: '503' }; }
      }
      return { ok: true as const, summary: source.items.join('\n') };
    };
    const tiers = { ...settings, thresholds: { immediateToShort: 99, shortToMiddle: 2, middleToLong: 99 } };
    await runMemoryRebuildTask(task, { settings: tiers, summarizer });
    expect(task.status).toBe('paused_failed'); expect(task.staging.中期记忆).toHaveLength(1);
    await runMemoryRebuildTask(task, { settings: tiers, summarizer });
    expect(requests).toEqual([1, 3, 3, 5]); expect(task.staging.中期记忆).toHaveLength(3);
  });

  it('records historical world moments without using the current calendar', async () => {
    const raw = history(1); const oldMoment: WorldMoment = { worldName: '提瓦特', date: '旅行历 1000.03.05', clock: '09:30', weather: '雨',
      location: '蒙德城', travelDay: 2, turn: 1, settlementId: 'old' };
    raw[1]!.worldMoment = oldMoment;
    const task = future(createMemoryRebuildTask({ chatHistory: raw, batchSize: 15 }));
    await runMemoryRebuildTask(task, { settings, summarizer: async () => ({ ok: true, summary: '摘要' }) });
    expect(task.turnSummaries[0]?.momentRange).toEqual({ start: oldMoment, end: oldMoment, sourceIds: ['u1', 'a1'] });
    expect(task.stagedIrminsul.entries.every(entry => entry.sourceMomentRange?.start?.travelDay === 2)).toBe(true);
  });
});
