import { expect, it, vi } from 'vitest';
import { prepareCoreMaintenance, restoreBoundMaintenancePlan } from '@/core/memory/maintenanceEntry';
import { runMemoryMaintenance } from '@/core/memory/maintenance';
import { makeMemoryMaintenanceFixture } from './memoryMaintenanceFixture';

it('previews real compression steps without a model call and runs the identical frozen range after confirmation', async () => {
  const f = await makeMemoryMaintenanceFixture(), summarize = vi.fn(async () => ({ kind: 'model' as const, text: '三次问候安柏的经历。' }));
  const result = await prepareCoreMaintenance({ scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, mode: 'compress', selectedMemoryIds: [], settings: f.input.settings }, { repo: f.repo });
  expect(result.modelRequests).toBe(1); expect(result.turns).toEqual([1, 2, 3]); expect((await f.repo.readHead(f.seed.head.scope)).memoryRevision).toBe(3); expect(summarize).not.toHaveBeenCalled();
  expect((await runMemoryMaintenance(result.plan, { repo: f.repo, summarize })).kind).toBe('completed'); expect(summarize).toHaveBeenCalledTimes(1);
  const job = (await f.repo.queryJobs({ scope: f.seed.head.scope, cutoffSeq: 3, jobIds: [result.plan.jobId] })).items[0]!;
  expect(restoreBoundMaintenancePlan(job, 'new-session').sessionId).toBe('new-session');
  expect(() => restoreBoundMaintenancePlan({ ...job, scope: { ...job.scope, branchId: 'wrong-branch' } }, 'new-session')).toThrow('CORE2_MAINTENANCE_JOB_BINDING');
});
it('rebuilds exactly the selected memory’s real turns and refuses missing selections', async () => {
  const f = await makeMemoryMaintenanceFixture(), memory = f.memories.find(row => row.turns.includes(2))!;
  const input = { scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, mode: 'rebuild' as const, selectedMemoryIds: [memory.memoryId], settings: f.input.settings };
  const result = await prepareCoreMaintenance(input, { repo: f.repo });
  expect(result.turns).toEqual([2]); expect(result.plan.steps).toHaveLength(1);
  await expect(prepareCoreMaintenance({ ...input, selectedMemoryIds: ['missing-memory'] }, { repo: f.repo })).rejects.toThrow('CORE2_MAINTENANCE_SELECTION_MISSING');
});
