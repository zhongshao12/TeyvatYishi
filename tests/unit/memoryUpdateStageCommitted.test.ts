import { describe, expect, it, vi } from 'vitest';
import { runMemoryUpdateStage } from '@/hooks/useGame/memoryUpdateStage';
import { 创建空记忆系统 } from '@/models/memory';
import { createEmptyIrminsulMemory } from '@/models/teyvat/irminsul';
import { createEmptyTeyvatWorld } from '@/models/teyvat/world';
import { captureWorldMoment } from '@/services/worldMoment';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import type { API配置项 } from '@/models/settings';
import type { NarrativeTurn } from '@/models/teyvat/narrativeTurn';

const compression = vi.hoisted(() => ({ settle: vi.fn() }));
vi.mock('@/hooks/useGame/postNarrativeMemoryStage', () => ({ settlePostNarrativeMemory: compression.settle }));

describe('committed memory stage', () => {
  it('passes the frozen committed moment rather than reading a later live clock', async () => {
    const world = createEmptyTeyvatWorld();
    world.当前时间 = '14:00';
    const moment = captureWorldMoment(world, 2, 'turn-2');
    world.当前时间 = '18:00';
    const memory = 创建空记忆系统();
    const irminsul = createEmptyIrminsulMemory();
    compression.settle.mockResolvedValue({ memory, irminsul, feedback: { status: 'success', detail: '已记录' } });
    const setQueueTasks = vi.fn();
    const state = { turnCount: 2, setQueueTasks, gameSettings: {} } as unknown as UseGameStateReturn;

    await runMemoryUpdateStage({
      state, userInput: '继续', config: {} as API配置项, displayText: '正文',
      parsedForDisplay: { continuation: { summary: '摘要' } } as NarrativeTurn,
      abortController: new AbortController(), assertWorkflowActive: () => undefined,
      memory, irminsul, moment,
    });

    expect(compression.settle).toHaveBeenCalledWith(expect.objectContaining({
      memory, irminsul, moment: expect.objectContaining({ clock: '14:00', settlementId: 'turn-2' }),
    }));
  });
});
