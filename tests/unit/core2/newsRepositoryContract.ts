import { expect, it, vi } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import type { WirePreparedImport } from '@/core/persistence/desktopProtocol';
import { encodePreparedImport } from '@/core/persistence/desktopProtocol';
import { createCoreController } from '@/core/settlement/coreController';
import { exportCorePackage, prepareCoreImport } from '@/core/persistence/packageTransfer';
import { makeSeed } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';
import { nextBatch } from './snapshotRepositoryContract';

export function assertNewsRepositoryContract(factory: () => Promise<CoreRepository>, rawImport?: (input: WirePreparedImport) => Promise<unknown>): void {
  it('recovers an actual staged news issue across export/import and rejects private citations at the storage boundary', async () => {
    const repo = await factory(), seed = makeSeed(); seed.records = seed.records.filter(row => row.domain !== 'album'); await repo.initialize(seed);
    const publicBatch = makeBatch(seed); publicBatch.jobs = []; publicBatch.commitments = [];
    publicBatch.events[0]!.visibility = { kind: 'public', npcIds: [] };
    await prepareBatch(repo, publicBatch); expect((await repo.commit(publicBatch)).status).toBe('committed');
    const privateBatch = await nextBatch(repo, seed.head.scope); privateBatch.events[0]!.visibility = { kind: 'private', npcIds: ['npc-amber'] };
    await prepareBatch(repo, privateBatch); expect((await repo.commit(privateBatch)).status).toBe('committed');
    const generate = vi.fn(async () => ({ kind: 'generated' as const, articles: [{ title: '蒙德短讯', lead: '安柏送来苹果。', body: '这条公开见闻被完整保存。', sourceFactIds: [publicBatch.events[0]!.eventId] }],
      bundle: { bundleId: 'native-news-fixture', mandatoryText: '', optionalText: '', selectedLeafIds: [publicBatch.events[0]!.eventId], estimatedTokens: 20, budgetOverflow: false, diagnostics: [] } }));
    const put = repo.putSource.bind(repo); let lost = false;
    vi.spyOn(repo, 'putSource').mockImplementation(async source => { const result = await put(source); if (!lost && source.kind === 'news') { lost = true; throw Error('TEST_NEWS_ACK_LOST'); } return result; });
    const controller = createCoreController({ repo, newsModels: { generate, getModelIdentity: () => 'native-news-fixture' }, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => { throw Error('NO_MAIN_MODEL'); } }) });
    try {
      await controller.attach({ scope: seed.head.scope }); await controller.requestNews('native-news-request'); await controller.waitForBackground();
      const imported = await prepareCoreImport(await exportCorePackage(repo, seed.head.scope)), forged = structuredClone(imported);
      const output = forged.sources.find(row => row.record.kind === 'news')!;
      const privateEvent = forged.events.find(row => row.visibility.kind === 'private')!;
      output.record.publicCitations![0]!.eventIds = [privateEvent.eventId];
      await expect(repo.importPrepared(forged)).rejects.toThrow('CORE2_IMPORT_NEWS_CITATION');
      if (rawImport) {
        const wire = encodePreparedImport(imported); wire.sources.find(row => row.record.kind === 'news')!.record.publicCitations![0]!.eventIds = [privateEvent.eventId];
        await expect(rawImport(wire)).rejects.toThrow('CORE2_IMPORT_NEWS_CITATION');
      }
      await expect(repo.readHead(imported.manifest.scope)).rejects.toThrow('CORE2_BRANCH_NOT_FOUND');
      await repo.importPrepared(imported); await controller.attach({ scope: imported.manifest.scope });
      const job = imported.jobs.find(row => row.record.kind === 'news')!.record;
      expect((await controller.retryJob(job.jobId)).kind).toBe('completed'); await controller.waitForBackground();
      expect(generate).toHaveBeenCalledTimes(1);
      const state = await repo.readState(imported.manifest.scope), outputRef = imported.sources.find(row => row.record.kind === 'news')!.record.ref;
      const issue = state.records.find(row => row.domain === 'news' && row.value.sourceRef.sourceId === outputRef.sourceId); expect(issue).toBeTruthy();
      expect((await repo.readSource(outputRef))?.blocks[0]?.text).toContain('这条公开见闻被完整保存。');
    } finally { controller.dispose(); }
  });
}
