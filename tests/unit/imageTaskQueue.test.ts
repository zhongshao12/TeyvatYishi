import { describe, expect, it } from 'vitest';
import { createImageTaskQueue, recoverInterruptedTasks, recoverStaleTasks } from '../../utils/imageTaskQueue';

describe('imageTaskQueue', () => {
  it('runs tasks serially with concurrency 1', async () => {
    const order: string[] = [];
    const q = createImageTaskQueue({ concurrency: 1, maxRetries: 0 });
    const run = q.createRunner((taskId) => {
      order.push(taskId);
      return Promise.resolve();
    });
    const results = await Promise.all([run('a'), run('b')]);
    expect(order).toEqual(['a', 'b']);
    expect(results.every((r) => r.status === 'success')).toBe(true);
  });

  it('retries failed executions up to maxRetries', async () => {
    let calls = 0;
    const q = createImageTaskQueue({ concurrency: 1, maxRetries: 2 });
    const run = q.createRunner(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('boom'));
      return Promise.resolve();
    });
    const result = await run('x');
    expect(result.status).toBe('success');
    expect(calls).toBe(2);
  });

  it('fails permanently after exhausting retries', async () => {
    let calls = 0;
    const q = createImageTaskQueue({ concurrency: 1, maxRetries: 1 });
    const run = q.createRunner(() => {
      calls += 1;
      return Promise.reject(new Error('always fails'));
    });
    const result = await run('x');
    expect(result.status).toBe('failed');
    expect(result.error).toContain('always fails');
    expect(calls).toBe(2);
  });

  it('marks stale running tasks as failed on recovery', () => {
    const tasks = recoverStaleTasks([
      { id: 't1', status: 'running', startedAt: Date.now() - 11 * 60 * 1000 } as never,
      { id: 't2', status: 'running', startedAt: Date.now() - 1000 } as never,
      { id: 't3', status: 'success' } as never,
    ]);
    expect(tasks[0]!.status).toBe('failed');
    expect(tasks[0]!.error).toContain('中断');
    expect(tasks[1]!.status).toBe('running');
    expect(tasks[2]!.status).toBe('success');
  });

  it('supports cancelling a running task', async () => {
    let aborted = false;
    const q = createImageTaskQueue({ concurrency: 1, maxRetries: 0 });
    const run = q.createRunner((_id, signal) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
        setTimeout(resolve, 2000);
      }),
    );
    const promise = run('c');
    q.cancel('c');
    const result = await promise;
    expect(result.status).toBe('failed');
    expect(result.error).toContain('取消');
    expect(aborted).toBe(true);
  });

  it('treats a cancelled executor that still resolves as failed', async () => {
    const q = createImageTaskQueue({ concurrency: 1, maxRetries: 0 });
    const run = q.createRunner((_id, signal) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          // executor 忽略取消信号，稍后仍“成功”返回。
          setTimeout(() => resolve('late-result'), 20);
        });
      }),
    );
    const promise = run('x');
    q.cancel('x');
    const result = await promise;
    expect(result.status).toBe('failed');
    expect(result.error).toContain('取消');
    expect(result.value).toBeUndefined();
  });

  it('recovers running tasks without a live worker immediately', () => {
    const tasks = recoverInterruptedTasks(
      [
        { id: 't1', status: 'running' } as never,
        { id: 't2', status: 'running' } as never,
        { id: 't3', status: 'queued' } as never,
      ],
      new Set(['t2']),
    );
    expect(tasks[0]!.status).toBe('failed');
    expect(tasks[1]!.status).toBe('running');
    expect(tasks[2]!.status).toBe('queued');
  });

});