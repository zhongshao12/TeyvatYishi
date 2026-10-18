// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CoreFailureCenter } from '@/components/features/Core2/CoreFailureCenter';
import { recallFixture } from './recallFixture';
import { runCoreJob } from '@/core/jobs/jobRunner';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

it('distinguishes saved gameplay with a failed derived task and retries only that task', async () => {
  const f = await recallFixture(1), head = await f.repo.readHead(f.seed.head.scope), batch = f.batches[0]!;
  const job = { jobId: 'failed-summary', scope: head.scope, sessionId: head.sessionId, kind: 'turn_summary' as const, operationId: batch.operationId, sourceRefs: batch.sourceRefs,
    status: 'pending' as const, leaseId: null, configFingerprint: 'test', attempts: 0, steps: [], version: 1 };
  await f.repo.enqueueJob(job); await f.repo.claimJob({ scope: head.scope, sessionId: head.sessionId, jobId: job.jobId, leaseId: 'test-lease', sourceRefs: job.sourceRefs, expectedVersion: 1 });
  await f.repo.finishJob({ scope: head.scope, sessionId: head.sessionId, jobId: job.jobId, leaseId: 'test-lease', sourceRefs: job.sourceRefs, expectedVersion: 2, status: 'failed', failure: { code: 'MODEL_FAILED', detail: '模型超时' } });
  const retry = vi.fn().mockResolvedValue(undefined), node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  await act(async () => root.render(<CoreFailureCenter repo={f.repo} head={head} onRetryJob={retry} onStopJob={async () => undefined} onRetryTurn={async () => undefined} onStopTurn={async () => undefined} />));
  for (let i = 0; i < 100 && !node.textContent?.includes('模型超时'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(node.textContent).toContain('后台任务失败 · 剧情已保存');
  expect(node.textContent).toContain('模型超时');
  await act(async () => { [...node.querySelectorAll('button')].find(button => button.textContent === '重试此任务')!.click(); });
  expect(retry).toHaveBeenCalledExactlyOnceWith('failed-summary'); expect((await f.repo.readHead(head.scope)).coreSeq).toBe(head.coreSeq);
  await act(async () => root.unmount()); node.remove();
});

it('shows only the current failed attempt while retaining replaced failures for historical inspection', async () => {
  const f = await recallFixture(1), head = await f.repo.readHead(f.seed.head.scope), batch = f.batches[0]!;
  const makeJob = (jobId: string) => ({ jobId, scope: head.scope, sessionId: head.sessionId, kind: 'turn_summary' as const, operationId: batch.operationId, sourceRefs: batch.sourceRefs,
    status: 'pending' as const, leaseId: null, configFingerprint: 'test', attempts: 0, steps: [], version: 1 });
  const failJob = async (jobId: string, detail: string) => {
    await f.repo.enqueueJob(makeJob(jobId));
    await f.repo.claimJob({ scope: head.scope, sessionId: head.sessionId, jobId, leaseId: `lease-${jobId}`, sourceRefs: batch.sourceRefs, expectedVersion: 1 });
    await f.repo.finishJob({ scope: head.scope, sessionId: head.sessionId, jobId, leaseId: `lease-${jobId}`, sourceRefs: batch.sourceRefs, expectedVersion: 2, status: 'failed', failure: { code: 'TEST_FAILED', detail } });
  };
  await failJob('old-failure', '被成功重试替代的旧错误');
  await f.repo.enqueueJob({ ...makeJob('successful-retry'), retryOfJobId: 'old-failure' });
  expect((await runCoreJob({ scope: head.scope, sessionId: head.sessionId, jobId: 'successful-retry' }, { repo: f.repo, handlers: { turn_summary: { steps: [{ stepId: 'local', run: async () => [] }] } } })).kind).toBe('completed');
  await failJob('independent-failure', '仍需处理的另一项错误');
  const sourceReads = vi.spyOn(f.repo, 'readSource'), retry = vi.fn().mockResolvedValue(undefined);
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  try {
    await act(async () => root.render(<CoreFailureCenter repo={f.repo} head={head} onRetryJob={retry} onStopJob={async () => undefined} onRetryTurn={async () => undefined} onStopTurn={async () => undefined} />));
    for (let i = 0; i < 100 && !node.textContent?.includes('仍需处理的另一项错误'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(node.textContent).toContain('仍需处理的另一项错误');
    expect(node.textContent).not.toContain('被成功重试替代的旧错误');
    expect(node.textContent).not.toContain('successful-retry');
    const buttons = [...node.querySelectorAll('button')].filter(button => button.textContent === '重试此任务');
    expect(buttons).toHaveLength(1); await act(async () => buttons[0]!.click());
    expect(retry).toHaveBeenCalledExactlyOnceWith('independent-failure');
    expect(sourceReads).not.toHaveBeenCalled();
    expect((await f.repo.queryJobs({ scope: head.scope, cutoffSeq: head.coreSeq, jobIds: ['old-failure'] })).items[0]?.retriedByJobId).toBe('successful-retry');
  } finally { await act(async () => root.unmount()); node.remove(); }
});
