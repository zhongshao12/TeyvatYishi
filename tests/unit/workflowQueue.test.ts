import { describe, expect, it, vi } from 'vitest';
import type { UseGameStateReturn } from '@/hooks/useGameState';
import { cancelPendingWorkflowTasks, pushWorkflowQueueTask } from '@/hooks/useGame/workflowQueue';

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

  it('marks every pending task in the stopped turn without changing completed or earlier tasks', () => {
    const tasks = [
      { id: 'main_story' as const, title: '主剧情生成', turn: 4, timestamp: 1, status: 'success' as const },
      { id: 'steambird' as const, title: '蒸汽鸟报', turn: 5, timestamp: 2, status: 'pending' as const, cancellable: true },
      { id: 'courier' as const, title: '手机消息', turn: 5, timestamp: 3, status: 'pending' as const, cancellable: true },
      { id: 'memory' as const, title: '记忆整理', turn: 5, timestamp: 4, status: 'success' as const },
      { id: 'main_story' as const, title: '主剧情生成', turn: 5, timestamp: 5, status: 'pending' as const },
      { id: 'main_story' as const, title: '主剧情生成', turn: 5, timestamp: 6, status: 'success' as const },
    ];
    const result = cancelPendingWorkflowTasks(tasks, 5);

    expect(result.map((task) => task.status)).toEqual(['success', 'cancelled', 'cancelled', 'success', 'pending', 'success']);
    expect(result[1]).toMatchObject({ cancelled: true, cancellable: false });
    expect(result[1]?.detail).toContain('本回合');
  });
});
