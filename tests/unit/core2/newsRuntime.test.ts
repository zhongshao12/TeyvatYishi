import { expect, it, vi } from 'vitest';
import { createCoreController } from '@/core/settlement/coreController';
import { recallFixture } from './recallFixture';
import { exportCorePackage, prepareCoreImport } from '@/core/persistence/packageTransfer';
import { assetPublication } from './assetRepositoryContract';
import { makeSeed } from './fixtures';

async function fixture() {
  const f = await recallFixture(), publicId = f.batches[0]!.events[0]!.eventId;
  const asset = assetPublication(f.seed); asset.asset.assetId = 'asset-fixture'; await f.repo.publishAsset(asset);
  const generate = vi.fn(async () => ({ kind: 'generated' as const, articles: [{ title: '蒙德见闻', lead: '安柏送来苹果。', body: '安柏在城中向旅人送来苹果。', sourceFactIds: [publicId] }],
    bundle: { bundleId: 'actual-news-context', mandatoryText: '', optionalText: '', selectedLeafIds: [publicId], estimatedTokens: 20, budgetOverflow: false, diagnostics: [] } }));
  const controller = createCoreController({ repo: f.repo, newsModels: { generate, getModelIdentity: () => 'news-test-v1' }, turnDependencies: () => ({
    rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => { throw Error('NO_MAIN_GENERATION'); },
  }) });
  await controller.attach({ scope: f.seed.head.scope }); return { ...f, controller, generate, publicId };
}
it('generates and atomically publishes an independent public-fact issue without changing main turns or granting NPC knowledge', async () => {
  const f = await fixture(); expect(typeof f.controller.requestNews).toBe('function');
  const before = await f.repo.readState(f.seed.head.scope), known = await f.repo.queryKnowledge({ scope: before.head.scope, cutoffSeq: before.head.coreSeq });
  const request = await f.controller.requestNews('news-request-one'); expect(request.jobIds).toHaveLength(1);
  await f.controller.waitForBackground();
  const state = await f.repo.readState(before.head.scope), issue = state.records.find(row => row.domain === 'news' && !before.records.some(old => old.domain === 'news' && old.entityId === row.entityId));
  expect(issue?.domain).toBe('news'); if (issue?.domain !== 'news') throw Error('missing issue');
  expect(issue.value.eventIds).toEqual([f.publicId]); expect(f.generate).toHaveBeenCalledTimes(1);
  const source = await f.repo.readSource(issue.value.sourceRef); expect(source?.kind).toBe('news'); expect(source?.delivery?.bundles[0]?.bundleId).toBe('actual-news-context');
  expect(JSON.stringify(source)).not.toContain('PRIVATE_SUMMARY_SENTINEL');
  expect(state.records.find(row => row.domain === 'world')?.value.completedMainTurns).toBe(before.records.find(row => row.domain === 'world')?.value.completedMainTurns);
  expect((await f.repo.queryKnowledge({ scope: before.head.scope, cutoffSeq: state.head.coreSeq })).items).toEqual(known.items);
  await f.controller.requestNews('news-request-one'); await f.controller.waitForBackground(); expect(f.generate).toHaveBeenCalledTimes(1);
});
it('rejects private citations and keeps the failed issue independently retryable', async () => {
  const f = await fixture(); f.generate.mockImplementation(async () => ({ kind: 'generated', articles: [{ title: '无效', lead: '不能刊登', body: '不能刊登私聊', sourceFactIds: [f.batches[1]!.events[0]!.eventId] }], bundle: { bundleId: 'news-private-test', mandatoryText: '', optionalText: '', selectedLeafIds: [], estimatedTokens: 0, budgetOverflow: false, diagnostics: [] } }));
  const before = f.controller.getView().snapshot!, count = before.records.filter(row => row.domain === 'news').length;
  const receipt = await f.controller.requestNews('news-private'); await f.controller.waitForBackground();
  const state = await f.repo.readState(before.head.scope); expect(state.records.filter(row => row.domain === 'news')).toHaveLength(count);
  expect((await f.repo.queryJobs({ scope: state.head.scope, cutoffSeq: state.head.coreSeq, jobIds: receipt.jobIds })).items[0]?.status).toBe('failed');
});
it('retains a generated issue after acknowledgement loss and export/import without paying again', async () => {
  const f = await fixture(), put = f.repo.putSource.bind(f.repo); let lost = false;
  vi.spyOn(f.repo, 'putSource').mockImplementation(async source => { const ref = await put(source); if (!lost && source.kind === 'news') { lost = true; throw Error('TEST_NEWS_OUTPUT_ACK_LOST'); } return ref; });
  const receipt = await f.controller.requestNews('news-staged'); await f.controller.waitForBackground();
  expect(f.generate).toHaveBeenCalledTimes(1);
  const imported = await prepareCoreImport(await exportCorePackage(f.repo, f.seed.head.scope)); await f.repo.importPrepared(imported); await f.controller.attach({ scope: imported.manifest.scope });
  const job = imported.jobs.find(row => row.record.kind === 'news')!.record;
  expect((await f.controller.retryJob(job.jobId)).kind).toBe('completed'); await f.controller.waitForBackground(); expect(f.generate).toHaveBeenCalledTimes(1);
  expect(receipt.jobIds).toHaveLength(1);
});
it.each(['stop', 'switch'] as const)('does not save or publish a late generated issue after %s', async action => {
  const f = await fixture(); let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  const output = await f.generate(); f.generate.mockClear(); f.generate.mockImplementation(async () => { enter(); await held; return output; });
  const receipt = await f.controller.requestNews('news-late-' + action); await entered;
  const before = (await f.repo.readState(f.seed.head.scope)).records.filter(row => row.domain === 'news').length;
  if (action === 'stop') await f.controller.stopJob(receipt.jobIds[0]!); else await f.controller.initialize(makeSeed());
  release(); await f.controller.waitForBackground();
  expect((await f.repo.readState(f.seed.head.scope)).records.filter(row => row.domain === 'news')).toHaveLength(before);
  expect((await f.repo.querySources({ scope: f.seed.head.scope, cutoffSeq: (await f.repo.readHead(f.seed.head.scope)).coreSeq, kinds: ['news'] })).items).toEqual([]);
  f.controller.dispose();
});
it('rejects private fact citations in an imported generated draft before publishing any journey', async () => {
  const f = await fixture(), put = f.repo.putSource.bind(f.repo); let lost = false;
  vi.spyOn(f.repo, 'putSource').mockImplementation(async source => { const ref = await put(source); if (!lost && source.kind === 'news') { lost = true; throw Error('TEST_STAGED_NEWS'); } return ref; });
  await f.controller.requestNews('news-forged-citation'); await f.controller.waitForBackground();
  const imported = await prepareCoreImport(await exportCorePackage(f.repo, f.seed.head.scope)), output = imported.sources.find(row => row.record.kind === 'news')!;
  output.record.publicCitations![0]!.eventIds = [imported.events.find(event => event.visibility.kind === 'private')!.eventId];
  await expect(f.repo.importPrepared(imported)).rejects.toThrow('CORE2_IMPORT_NEWS_CITATION');
});
it('enqueues automatic news in the same main commit only at the configured game-turn interval', async () => {
  const f = await fixture(); f.controller.dispose();
  const controller = createCoreController({ repo: f.repo, newsModels: { generate: f.generate, getModelIdentity: () => 'news-test-v1', getAutomaticInterval: () => 2 }, turnDependencies: () => ({
    rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), factModel: async () => ({ kind: 'extracted', candidates: [], attempts: 0 }),
    generateNarrative: async () => JSON.stringify({ body: [{ kind: 'narration', text: '蒙德城一切平静。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } }),
  }) });
  try {
    const head = await controller.attach({ scope: f.seed.head.scope });
    const send = (operationId: string) => controller.send({ scope: head.scope, sessionId: head.sessionId, operationId, text: '继续' });
    await send('news-main-1'); await controller.waitForBackground(); expect(f.generate).not.toHaveBeenCalled();
    const second = await send('news-main-2'); if (second.kind !== 'committed') throw Error('fixture');
    const tasks = (await f.repo.queryJobs({ scope: head.scope, cutoffSeq: second.receipt.coreSeq, jobIds: second.receipt.jobIds })).items;
    expect(tasks.some(job => job.kind === 'news' && job.operationId === 'news-main-2')).toBe(true);
    await controller.waitForBackground(); expect(f.generate).toHaveBeenCalledTimes(1);
    await send('news-main-3'); await controller.waitForBackground(); expect(f.generate).toHaveBeenCalledTimes(1);
  } finally { controller.dispose(); }
});
it('joins concurrent retries of one stopped issue instead of creating a second model request or surfacing a replacement race', async () => {
  const f = await fixture(); f.generate.mockRejectedValueOnce(Error('TEST_NEWS_UNAVAILABLE'));
  try {
    const receipt = await f.controller.requestNews('news-race'); await f.controller.waitForBackground(); const original = receipt.jobIds[0]!;
    await f.controller.stopJob(original);
    const enqueue = f.repo.enqueueJob.bind(f.repo); let count = 0, release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(f.repo, 'enqueueJob').mockImplementation(async job => {
      if (job.kind === 'news' && job.retryOfJobId === original) { count++; if (count === 2) release(); await gate; }
      return enqueue(job);
    });
    const results = await Promise.allSettled([f.controller.retryJob(original), f.controller.retryJob(original)]);
    expect(results.map(row => row.status)).toEqual(['fulfilled', 'fulfilled']);
    if (results[0]!.status !== 'fulfilled' || results[1]!.status !== 'fulfilled') throw Error('retry did not join');
    expect(results[0]!.value).toMatchObject({ kind: 'completed', jobId: results[1]!.value.jobId });
    expect(f.generate).toHaveBeenCalledTimes(2);
    expect((await f.repo.queryJobs({ scope: receipt.scope, cutoffSeq: (await f.repo.readHead(receipt.scope)).coreSeq, kinds: ['news'] })).items.filter(row => row.status === 'completed')).toHaveLength(1);
  } finally { f.controller.dispose(); }
});
it('rejects a news request reusing a committed main operation identity', async () => {
  const f = await fixture();
  try { await expect(f.controller.requestNews(f.batches[0]!.operationId)).rejects.toThrow('CORE2_NEWS_OPERATION_ID_REUSED'); expect(f.generate).not.toHaveBeenCalled(); }
  finally { f.controller.dispose(); }
});
