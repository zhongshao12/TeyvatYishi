import { describe, expect, it } from 'vitest';
import { normalizeConversationLog } from '@/models/teyvat/runtimeSlices';

/**
 * C4：对话日志里只保留**最后一条**回合快照。
 *
 * 背景：每条快照要跑 13 个子系统的深度归一化（实测约 510µs/条），而 `normalizeConversationLog`
 * 在**每次根归一化**时都会跑 —— 600 条 checkpoint 的旧档每回合要多付约 315ms。
 * reroll 只用最后一条快照（`hooks/useGame.ts` 的 handleReroll），
 * 且 aiMessageStage 本来就清掉上一条 user 快照以免存档膨胀，所以只保留最后一条是安全的。
 */

const entry = (id: string, withCheckpoint: boolean, turnCount = 1) => ({
  id,
  role: 'assistant',
  content: `内容 ${id}`,
  timestamp: 1000,
  ...(withCheckpoint
    ? { preTurnState: { turnCount, world: { 当前地点: '蒙德城' }, inventory: { items: [], mora: 7 } } }
    : {}),
});

describe('对话日志的回合快照保留策略', () => {
  it('keeps only the latest checkpoint', () => {
    const log = normalizeConversationLog({
      entries: [entry('a', true, 1), entry('b', true, 2), entry('c', true, 3)],
    });

    const withCheckpoint = log.entries.filter((item) => item.preTurnState);
    expect(withCheckpoint).toHaveLength(1);
    expect(withCheckpoint[0]?.id).toBe('c');
  });

  it('normalizes the retained checkpoint instead of passing it through raw', () => {
    const log = normalizeConversationLog({ entries: [entry('only', true, 42)] });

    expect(log.entries[0]?.preTurnState?.turnCount).toBe(42);
    expect((log.entries[0]?.preTurnState as { inventory?: { mora?: number } } | undefined)?.inventory?.mora).toBe(7);
  });

  it('keeps the newest checkpoint even when earlier entries are the ones with snapshots', () => {
    const log = normalizeConversationLog({
      entries: [entry('a', false), entry('b', true, 5), entry('c', false)],
    });

    const withCheckpoint = log.entries.filter((item) => item.preTurnState);
    expect(withCheckpoint).toHaveLength(1);
    expect(withCheckpoint[0]?.id).toBe('b');
  });

  it('leaves a log without checkpoints untouched', () => {
    const log = normalizeConversationLog({ entries: [entry('a', false), entry('b', false)] });

    expect(log.entries).toHaveLength(2);
    expect(log.entries.every((item) => item.preTurnState === undefined)).toBe(true);
  });

  it('drops checkpoints for non-record entries without throwing', () => {
    const log = normalizeConversationLog({ entries: [null, 'x', entry('a', true, 2)] });

    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]?.preTurnState?.turnCount).toBe(2);
  });
});
