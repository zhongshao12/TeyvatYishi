import { describe, expect, it, vi } from 'vitest';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import { pushWorkflowQueueTask } from '@/hooks/useGame/workflowQueue';

describe('workflow queue publisher', () => {
  it('publishes a bounded task record with the canonical title and target', () => {
    let tasks = Array.from({ length: 30 }, (_, index) => ({ id: 'memory' as const, title: `${index}`, subtitle: '', turn: index, timestamp: index, status: 'success' as const }));
    const setQueueTasks = vi.fn((update: (previous: typeof tasks) => typeof tasks) => {
      tasks = update(tasks);
    });
    const state = { turnCount: 12, setQueueTasks } as unknown as UseGameStateReturn;

    const record = pushWorkflowQueueTask(state, 'narrative_image_generate', 'pending', {
      targetMessageId: 'assistant-12',
      detail: '生成中',
    });

    expect(record).toMatchObject({
      title: '故事快照生成',
      turn: 12,
      status: 'pending',
      targetMessageId: 'assistant-12',
    });
    expect(tasks).toHaveLength(25);
  });
});
