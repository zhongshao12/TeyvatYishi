import { describe, expect, it } from 'vitest';
import {
  runPostTurnBackgroundTasks,
  runSteambirdPostTurnTask,
} from '@/hooks/useGame/postTurnBackgroundTasks';

describe('post-turn background task orchestration', () => {
  it('builds one concise Steambird article only when the turn is eligible', () => {
    const output = runSteambirdPostTurnTask({
      enabled: true,
      shouldRun: true,
      openingTurn: false,
      interval: 5,
      current: { articles: [] },
      turn: 10,
      userInput: '旅行者抵达蒙德。',
      body: '骑士团确认城门恢复通行。',
      now: 1000,
    });

    expect(output.status).toBe('success');
    expect(output.changed).toBe(true);
    expect(output.news.articles).toHaveLength(1);
    expect(output.news.articles[0]?.body).toContain('骑士团确认城门恢复通行');
  });

  it('runs every task in deterministic order in sequential mode', async () => {
    const order: string[] = [];
    const job = (name: string) => async () => { order.push(name); };

    await runPostTurnBackgroundTasks({
      mode: 'sequential',
      steambird: job('steambird'),
      irminsul: job('irminsul'),
      courierDelivery: job('courier-delivery'),
      courierReply: job('courier-reply'),
      narrativeImage: job('image'),
    });

    expect(order).toEqual(['steambird', 'irminsul', 'courier-delivery', 'courier-reply', 'image']);
  });

  it('keeps courier reply dependent on delivery while starting independent jobs in parallel', async () => {
    const started = new Set<string>();
    let deliveryFinished = false;
    let releaseDelivery!: () => void;
    const deliveryGate = new Promise<void>((resolve) => { releaseDelivery = resolve; });

    const running = runPostTurnBackgroundTasks({
      mode: 'parallel',
      steambird: async () => { started.add('steambird'); },
      irminsul: async () => { started.add('irminsul'); },
      courierDelivery: async () => {
        started.add('courier-delivery');
        await deliveryGate;
        deliveryFinished = true;
      },
      courierReply: async () => {
        expect(deliveryFinished).toBe(true);
        started.add('courier-reply');
      },
      narrativeImage: async () => { started.add('image'); },
    });

    await Promise.resolve();
    expect(started).toEqual(new Set(['steambird', 'irminsul', 'courier-delivery', 'image']));
    releaseDelivery();
    await running;
    expect(started).toContain('courier-reply');
  });
});
