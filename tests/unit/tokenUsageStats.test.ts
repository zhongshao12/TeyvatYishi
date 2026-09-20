import { describe, expect, it } from 'vitest';
import { 累计Token用量, 拆分Token用量, 拆分聊天Token用量, 是否超预算 } from '../../utils/tokenUsageStats';
import type { 聊天消息 } from '../../models/chat';

describe('tokenUsageStats', () => {
  const usage = (system: string | undefined, input: number, output: number) => ({
    inputTokens: input, outputTokens: output, totalTokens: input + output, source: 'api' as const, system,
  });

  it('aggregates totals from chat history', () => {
    const messages = [
      { id: 'm1', role: 'assistant' as const, content: 'a', timestamp: 1, tokenUsage: usage('main_story', 100, 50) },
      { id: 'm2', role: 'assistant' as const, content: 'b', timestamp: 2, tokenUsage: usage('steambird', 20, 10) },
      { id: 'm3', role: 'user' as const, content: 'c', timestamp: 3 },
    ];
    const totals = 累计Token用量(messages);
    expect(totals).toEqual({ inputTokens: 120, outputTokens: 60, totalTokens: 180 });
  });

  it('splits usage by system with main_story fallback', () => {
    const bySystem = 拆分Token用量([
      usage(undefined, 100, 50),
      usage('steambird', 20, 10),
      usage('main_story', 30, 30),
    ]);
    expect(bySystem.main_story).toEqual({ inputTokens: 130, outputTokens: 80, totalTokens: 210 });
    expect(bySystem.steambird).toEqual({ inputTokens: 20, outputTokens: 10, totalTokens: 30 });
  });

  it('splits from chat history and detects budget overflow', () => {
    const messages: 聊天消息[] = [
      { id: 'm1', role: 'assistant', content: 'a', timestamp: 1, tokenUsage: usage('main_story', 100, 0) },
    ];
    const bySystem = 拆分聊天Token用量(messages);
    expect(bySystem.main_story!.totalTokens).toBe(100);
    expect(是否超预算({ inputTokens: 0, outputTokens: 0, totalTokens: 150 }, 100)).toBe(true);
    expect(是否超预算({ inputTokens: 0, outputTokens: 0, totalTokens: 50 }, 100)).toBe(false);
    expect(是否超预算({ inputTokens: 0, outputTokens: 0, totalTokens: 150 }, undefined)).toBe(false);
  });
});
