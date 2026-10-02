import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FAILURE_CENTER_LIMIT,
  countOpenFailures,
  evictFailures,
  failureItemId,
  mergeFailureItem,
  type FailureItem,
} from '@/models/failureCenter';
import {
  beginFailureRetry,
  failFailureRetry,
  getFailureCenter,
  getOpenFailureCount,
  ignoreFailure,
  registerFailureRetry,
  reportFailure,
  resetFailureCenterMemory,
  resolveFailure,
  runFailureRetry,
} from '@/utils/failureCenterStore';
import { pushWorkflowQueueTask } from '@/hooks/useGame/workflowQueue';

/**
 * 用户第 5 项「把各种失败整合成失败结算中心」。
 *
 * 分工：toast = 刚刚发生了什么（瞬时）；队列 = 本回合跑了什么（25 条）；
 * 中心 = **现在还有什么没解决**（持久、可重试、可展开诊断）。
 */

function item(overrides: Partial<FailureItem> = {}): FailureItem {
  return {
    id: 'main_story:main_story:3', source: 'main_story', turn: 3, occurredAt: 1,
    reasonCode: 'main_story_failed', humanReason: '回合结算失败', retryable: 'manual',
    status: 'open', attemptCount: 1, firstSeenAt: 1, lastSeenAt: 1, dedupeKey: 'main_story:3',
    ...overrides,
  };
}

beforeEach(() => resetFailureCenterMemory());

describe('失败结算中心（2026-09-29 第 5 项）', () => {
  it('同一失败重复发生只累加次数，不刷屏', () => {
    reportFailure({ source: 'courier', reasonCode: 'courier_failed', humanReason: '手机消息失败', dedupeKey: 'courier:5', turn: 5, now: 100 });
    reportFailure({ source: 'courier', reasonCode: 'courier_failed', humanReason: '手机消息失败', dedupeKey: 'courier:5', turn: 5, now: 200 });
    const list = getFailureCenter();
    expect(list).toHaveLength(1);
    expect(list[0]!.attemptCount).toBe(2);
    expect(list[0]!.firstSeenAt).toBe(100);
    expect(list[0]!.lastSeenAt).toBe(200);
  });

  it('解决后再次出现视为新一轮（次数重置、状态回到 open）', () => {
    reportFailure({ source: 'memory', reasonCode: 'memory_failed', humanReason: '记忆失败', dedupeKey: 'memory:2', now: 1 });
    resolveFailure(failureItemId('memory', 'memory:2'));
    expect(getOpenFailureCount()).toBe(0);
    reportFailure({ source: 'memory', reasonCode: 'memory_failed', humanReason: '记忆失败', dedupeKey: 'memory:2', now: 9 });
    const entry = getFailureCenter()[0]!;
    expect(entry.status).toBe('open');
    expect(entry.attemptCount).toBe(1);
    expect(entry.firstSeenAt).toBe(9);
  });

  it('上限淘汰只吃已解决/已忽略，未解决的失败不会被静默挤掉', () => {
    const open = Array.from({ length: FAILURE_CENTER_LIMIT + 20 }, (_value, index) => item({
      id: `open_${index}`, dedupeKey: `open_${index}`, lastSeenAt: index,
    }));
    const resolved = Array.from({ length: 30 }, (_value, index) => item({
      id: `done_${index}`, dedupeKey: `done_${index}`, status: 'resolved', lastSeenAt: index,
    }));
    const kept = evictFailures([...open, ...resolved]);
    expect(kept).toHaveLength(FAILURE_CENTER_LIMIT);
    expect(kept.every((entry) => entry.status === 'open')).toBe(true);
    // 未解决的全部保留；已解决的全部被淘汰。
    expect(kept.filter((entry) => entry.id.startsWith('open_'))).toHaveLength(FAILURE_CENTER_LIMIT);
    expect(kept.some((entry) => entry.id.startsWith('done_'))).toBe(false);
  });

  it('合并保留首次时间与累计次数（结构级）', () => {
    const merged = mergeFailureItem(
      item({ attemptCount: 2, firstSeenAt: 5, status: 'open' }),
      item({ attemptCount: 1, firstSeenAt: 8, status: 'open', lastSeenAt: 8 }),
    );
    expect(merged.attemptCount).toBe(3);
    expect(merged.firstSeenAt).toBe(5);
    expect(merged.lastSeenAt).toBe(8);
  });

  it('重试生命周期：retrying → 成功即 resolved，失败回到 open 并保留诊断', async () => {
    const id = failureItemId('main_story', 'main_story:4');
    reportFailure({ source: 'main_story', reasonCode: 'main_story_failed', humanReason: '回合失败', dedupeKey: 'main_story:4', retryable: 'manual', now: 1 });
    registerFailureRetry(id, () => undefined);
    await expect(runFailureRetry(id)).resolves.toBe(true);
    expect(getFailureCenter()[0]!.status).toBe('resolved');

    resetFailureCenterMemory();
    reportFailure({ source: 'main_story', reasonCode: 'main_story_failed', humanReason: '回合失败', dedupeKey: 'main_story:4', retryable: 'manual', now: 1 });
    registerFailureRetry(id, () => { throw new Error('STILL_DOWN'); });
    await expect(runFailureRetry(id)).resolves.toBe(false);
    const failed = getFailureCenter()[0]!;
    expect(failed.status).toBe('open');
    expect(failed.attemptCount).toBe(2);
    expect(failed.diagnostic?.text).toBe('STILL_DOWN');
  });

  it('没有注册重试入口时不会假装能重试', async () => {
    reportFailure({ source: 'quest', reasonCode: 'quest_failed', humanReason: '任务失败', dedupeKey: 'quest:1', retryable: 'manual' });
    await expect(runFailureRetry(failureItemId('quest', 'quest:1'))).resolves.toBe(false);
  });

  it('忽略与手动标记已解决都会离开未解决计数', () => {
    reportFailure({ source: 'image', reasonCode: 'image_failed', humanReason: '生图失败', dedupeKey: 'image:1' });
    ignoreFailure(failureItemId('image', 'image:1'));
    expect(getOpenFailureCount()).toBe(0);
    beginFailureRetry(failureItemId('image', 'image:1'));
    expect(getFailureCenter()[0]!.status).toBe('retrying');
    failFailureRetry(failureItemId('image', 'image:1'));
    expect(getOpenFailureCount()).toBe(1);
  });

  it('队列是后台任务失败的统一漏斗：failed 任务会进中心', () => {
    const setQueueTasks = vi.fn();
    const state = { turnCount: 7, setQueueTasks } as unknown as Parameters<typeof pushWorkflowQueueTask>[0];
    pushWorkflowQueueTask(state, 'quest', 'failed', { detail: '任务结算失败：模型超时' });
    expect(setQueueTasks).toHaveBeenCalled();
    const entry = getFailureCenter().find((item) => item.source === 'quest');
    expect(entry).toBeDefined();
    expect(entry?.retryable).toBe('manual');
    expect(entry?.humanReason).toContain('模型超时');
    expect(entry?.turn).toBe(7);
  });

  it('成功/跳过状态不产生失败记录', () => {
    const state = { turnCount: 7, setQueueTasks: vi.fn() } as unknown as Parameters<typeof pushWorkflowQueueTask>[0];
    pushWorkflowQueueTask(state, 'quest', 'success', { detail: '完成' });
    pushWorkflowQueueTask(state, 'quest', 'skipped', { detail: '跳过' });
    expect(getOpenFailureCount()).toBe(0);
  });

  it('未解决计数只统计 open / retrying', () => {
    expect(countOpenFailures([item(), item({ status: 'resolved' }), item({ status: 'ignored' })])).toBe(1);
  });
});
