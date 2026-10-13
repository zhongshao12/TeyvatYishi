import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { createEmptyTeyvatGameState, normalizeConversationLog } from '@/models/teyvat';
import { applyChatHistoryAction, createLegacyGameViewSelector } from '@/hooks/useGameState';

function history(count = 800) {
  const game = createEmptyTeyvatGameState();
  game.对话 = normalizeConversationLog({ entries: Array.from({ length: count }, (_, index) => ({
    id: `m${index}`, role: 'assistant', content: '旅途正文'.repeat(200), timestamp: index,
    debugMetadata: { systemPrompt: '背景参考'.repeat(300), messages: Array.from({ length: 25 }, () => ({ role: 'user', content: '经历'.repeat(200) })) },
  })) });
  return game;
}

describe('incremental chat projection', () => {
  it('reuses unchanged message projections when streaming changes only the last message', () => {
    const game = history(4); const select = createLegacyGameViewSelector(); const first = select(game);
    const next = { ...game, 对话: { entries: game.对话.entries.map((entry, index) => index === 3 ? { ...entry, content: '新正文' } : entry) } };
    const second = select(next);
    expect(second.chatHistory[0]).toBe(first.chatHistory[0]);
    expect(second.chatHistory[3]).not.toBe(first.chatHistory[3]);
    expect(second.chatHistory[3]?.content).toBe('新正文');
  });
  it('retains canonical records and treats a copied but unchanged list as a no-op', () => {
    const game = history(4);
    expect(applyChatHistoryAction(game, messages => [...messages])).toBe(game);
    const changed = applyChatHistoryAction(game, messages => messages.map((message, index) => index === 3 ? { ...message, content: '流式增量' } : message));
    expect(changed.对话.entries[0]).toBe(game.对话.entries[0]);
    expect(changed.对话.entries[3]?.content).toBe('流式增量');
    expect(game.对话.entries[3]?.content).not.toBe('流式增量');
  });
  it('still keeps only the latest checkpoint when appending a new reroll anchor', () => {
    const game = history(2); game.对话.entries[0] = { ...game.对话.entries[0]!, preTurnState: { turnCount: 1, pendingOpeningTrigger: null } };
    const next = applyChatHistoryAction(game, messages => [...messages, {
      id: 'new', role: 'user', content: '继续', timestamp: 3,
      preTurnSnapshot: { turnCount: 2, pendingOpeningTrigger: null } as never,
    }]);
    expect(next.对话.entries[0]?.preTurnState).toBeUndefined();
    expect(next.对话.entries[2]?.preTurnState?.turnCount).toBe(2);
    expect(game.对话.entries[0]?.preTurnState?.turnCount).toBe(1);
  });
  it('reports a repeatable large-history workload without an absolute timing assertion', () => {
    let game = history(); const select = createLegacyGameViewSelector(); select(game);
    const start = performance.now();
    for (let step = 0; step < 20; step += 1) {
      game = applyChatHistoryAction(game, messages => messages.map((message, index) => index === 799 ? { ...message, content: `片段${step}` } : message));
      select(game);
    }
    console.info(`chat-projection-benchmark: 800 messages, 25 debug messages each, 20 tail updates = ${(performance.now() - start).toFixed(1)} ms`);
    expect(game.对话.entries).toHaveLength(800);
    expect(game.对话.entries[799]?.content).toBe('片段19');
  });
});
