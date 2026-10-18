import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { exportCorePackage, prepareCoreImport } from '@/core/persistence/packageTransfer';
import { planMemoryMaintenance, runMemoryMaintenance } from '@/core/memory/maintenance';
import { checksumBytes } from '@/core/sources/sourceIntegrity';
import { makeMemoryMaintenanceFixture } from './memoryMaintenanceFixture';

it.each(['compress', 'rebuild'] as const)('resumes imported %s publication without repeating acknowledged model steps', async mode => {
  const f = await makeMemoryMaintenanceFixture(), bytes = new Uint8Array([137, 80, 78, 71]);
  await f.repo.publishAsset({ scope: f.seed.head.scope, sessionId: f.seed.head.sessionId, asset: { scope: f.seed.head.scope, assetId: 'asset-fixture', mimeType: 'image/png', bytes, checksum: checksumBytes(bytes) } });
  const summarize = vi.fn(async () => ({ kind: 'model' as const, text: '已整理的三次旅途问候。' }));
  const plan = planMemoryMaintenance({ ...f.input, mode, ...(mode === 'rebuild' ? { selectedTurns: [1, 2, 3] } : {}) });
  vi.spyOn(f.repo, 'publishDerived').mockRejectedValueOnce(Error('temporary publication failure'));
  expect((await runMemoryMaintenance(plan, { repo: f.repo, summarize })).kind).toBe('failed');
  expect(summarize).toHaveBeenCalledTimes(mode === 'compress' ? 1 : 3);
  const prepared = await prepareCoreImport(await exportCorePackage(f.repo, f.seed.head.scope));
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-maintenance-import-${mode}-${crypto.randomUUID()}` }), head = await repo.importPrepared(prepared);
  const retryModel = vi.fn(async () => ({ kind: 'failed' as const, code: 'MUST_NOT_CALL', detail: '已确认的模型步骤不应再请求。' }));
  const controller = createCoreController({ repo, memoryModels: { summarize: retryModel }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, summarySettings: f.input.settings,
    assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: vi.fn(), factModel: vi.fn() }) });
  await controller.attach({ scope: head.scope });
  const job = (await repo.queryJobs({ scope: head.scope, cutoffSeq: head.coreSeq, kinds: [mode === 'compress' ? 'compression' : 'rebuild'] })).items[0]!;
  expect((await controller.retryJob(job.jobId)).kind).toBe('completed'); await controller.waitForBackground();
  const current = await repo.readHead(head.scope), active = (await repo.queryMemories({ scope: head.scope, cutoffSeq: current.coreSeq, memoryRevision: current.memoryRevision, statuses: ['active'] })).items;
  expect(retryModel).not.toHaveBeenCalled(); expect(current.coreSeq).toBe(head.coreSeq);
  expect(active).toHaveLength(mode === 'compress' ? 1 : 3); expect([...new Set(active.flatMap(row => row.turns))].sort()).toEqual([1, 2, 3]);
});
