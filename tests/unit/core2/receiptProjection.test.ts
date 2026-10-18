import { expect, it } from 'vitest';
import { projectCoreReceipt } from '@/core/settlement/receiptProjection';
import { makeCommit, makeSeed } from './fixtures';
it('distinguishes a saved core from failed memory work and from an unsaved storage failure', () => {
  const seed = makeSeed(), batch = makeCommit(seed.head);
  const receipt = { status: 'committed' as const, scope: seed.head.scope, operationId: batch.operationId, coreSeq: 1, eventIds: batch.events.map(e => e.eventId), jobIds: ['summary'] };
  const events = batch.events.map(event => ({ ...event, commitSeq: 1 }));
  const jobs = [{ jobId: 'summary', scope: seed.head.scope, sessionId: seed.head.sessionId, operationId: batch.operationId, kind: 'turn_summary' as const, sourceRefs: batch.sourceRefs, status: 'failed' as const, leaseId: null, configFingerprint: 'test', attempts: 1, steps: [], version: 2, failure: { code: 'timeout', detail: '模型超时' } }];
  expect(projectCoreReceipt(receipt, events, jobs)).toMatchObject({ saved: true, memoryPending: true, status: 'committed' });
  expect(projectCoreReceipt({ status: 'failed', scope: seed.head.scope, operationId: batch.operationId, code: 'disk', detail: '保存失败' }, events, jobs)).toMatchObject({ saved: false, memoryPending: false, changes: [], reason: '保存失败' });
  expect(projectCoreReceipt(receipt, [...events, { ...events[0]!, operationId: 'other-operation', eventId: 'unrelated' }], jobs).changes).toHaveLength(1);
});
