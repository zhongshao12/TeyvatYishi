import { describe, expect, it } from 'vitest';

import {
  compactChatHistoryForLongSession,
  DETAILED_CHAT_TURNS,
  FULL_DEBUG_CHAT_TURNS,
} from '@/utils/longSessionRetention';
import type { 聊天消息 } from '@/models/chat';

const SYSTEM_PROMPT = '系统提示词'.repeat(500);

function makeTurn(turn: number): 聊天消息[] {
  return [
    { id: `user-${turn}`, role: 'user', content: `输入-${turn}`, timestamp: turn * 2 - 1 },
    {
      id: `assistant-${turn}`,
      role: 'assistant',
      content: `正文-${turn}`,
      timestamp: turn * 2,
      debugContext: {
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `消息链-${turn}` }],
        recallSummary: `召回摘要-${turn}`,
        recallFullContent: '召回全文'.repeat(200),
        irminsulRecallRawText: '世界树原始返回'.repeat(200),
        npcLedgerSelectionRaw: { selected: [], skipped: [] } as never,
      },
    },
  ];
}

function makeHistory(turns: number): 聊天消息[] {
  return Array.from({ length: turns }, (_, index) => makeTurn(index + 1)).flat();
}

describe('长会话 debugContext 瘦身', () => {
  it('最近回合保留完整请求上下文', () => {
    const compacted = compactChatHistoryForLongSession(makeHistory(10));
    const assistants = compacted.filter((message) => message.role === 'assistant');
    const last = assistants.at(-1)!;
    expect(last.debugContext?.systemPrompt).toBe(SYSTEM_PROMPT);
    expect(last.debugContext?.messages).toHaveLength(1);
    const secondLast = assistants.at(-2)!;
    expect(secondLast.debugContext?.systemPrompt).toBe(SYSTEM_PROMPT);
  });

  it(`窗口内第 ${FULL_DEBUG_CHAT_TURNS + 1} 回合起走瘦身：大字段占位、小字段保留`, () => {
    const compacted = compactChatHistoryForLongSession(makeHistory(10));
    const assistants = compacted.filter((message) => message.role === 'assistant');
    const slim = assistants.at(-1 - FULL_DEBUG_CHAT_TURNS)!;
    expect(slim.debugContext?.systemPrompt).toContain('已瘦身');
    expect(slim.debugContext?.messages).toEqual([]);
    expect(slim.debugContext?.recallFullContent).toContain('已瘦身');
    expect(slim.debugContext?.irminsulRecallRawText).toContain('已瘦身');
    expect(slim.debugContext?.npcLedgerSelectionRaw).toBeUndefined();
    // 小诊断字段不受瘦身影响
    expect(slim.debugContext?.recallSummary).toBe(`召回摘要-${10 - FULL_DEBUG_CHAT_TURNS}`);
  });

  it(`窗口外（超过 ${DETAILED_CHAT_TURNS} 回合）debugContext 整体丢弃`, () => {
    const compacted = compactChatHistoryForLongSession(makeHistory(30));
    const assistants = compacted.filter((message) => message.role === 'assistant');
    expect(assistants.filter((message) => message.debugContext).length).toBe(DETAILED_CHAT_TURNS);
    expect(assistants[0].debugContext).toBeUndefined();
  });

  it('短会话（不超过窗口）不做瘦身', () => {
    const compacted = compactChatHistoryForLongSession(makeHistory(FULL_DEBUG_CHAT_TURNS));
    for (const message of compacted.filter((entry) => entry.role === 'assistant')) {
      expect(message.debugContext?.systemPrompt).toBe(SYSTEM_PROMPT);
      expect(message.debugContext?.recallFullContent).not.toContain('已瘦身');
    }
  });
});
