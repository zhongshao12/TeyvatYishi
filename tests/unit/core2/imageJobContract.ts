import { expect, it, vi } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import { requestCoreImage, runCoreImageJob } from '@/core/jobs/imageJob';
import { makeSeed } from './fixtures';
import { AMBER_IMAGE_FACTS, seedAmberImageFacts } from './imageEnglishFixture';
import { exportCorePackage, prepareCoreImport } from '@/core/persistence/packageTransfer';

const png = () => Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII='), char => char.charCodeAt(0));
export function assertImageJobContract(factory: () => Promise<CoreRepository>): void {
async function fixture() {
  const repo = await factory(), seed = makeSeed(); seedAmberImageFacts(seed); seed.records = seed.records.filter(row => row.domain !== 'album'); await repo.initialize(seed);
  let active: { scope: typeof seed.head.scope; sessionId: string } | null = { scope: seed.head.scope, sessionId: seed.head.sessionId };
  const generate = vi.fn(async () => ({ bytes: png(), mimeType: 'image/png', finalPrompt: 'Amber, portrait', finalNegative: 'watermark' }));
  const deps = { repo, models: { generate, getModelIdentity: () => 'image-fixture-v1' }, getActiveSession: () => active };
  const request = { ...active, operationId: 'image-request-one', title: '安柏的照片', kind: 'character' as const, npcIds: ['npc-amber'], prompt: 'Amber, portrait', negative: 'watermark', size: '512x512', characters: [AMBER_IMAGE_FACTS] };
  return { repo, seed, generate, deps, request, detach: () => { active = null; } };
}
it('publishes a generated image exactly once with persisted prompt provenance and no game-time or knowledge changes', async () => {
  const f = await fixture(), before = await f.repo.readState(f.seed.head.scope), receipt = await requestCoreImage(f.request, f.deps);
  const jobId = receipt.jobIds[0]!; expect((await runCoreImageJob({ ...f.request, jobId }, f.deps)).kind).toBe('completed');
  const state = await f.repo.readState(f.seed.head.scope), photo = state.records.find(row => row.domain === 'album'); if (photo?.domain !== 'album') throw Error('missing image');
  expect([...(await f.repo.readAsset(photo.value.assetId))!.bytes]).toEqual([...png()]);
  const source = await f.repo.readSource(photo.value.sourceRefs[0]!); expect(source?.kind).toBe('image'); expect(source?.assetRefs).toEqual([photo.value.assetId]); expect(source?.blocks[0]?.text).toContain('Amber, portrait');
  expect((await f.repo.querySources({ scope: state.head.scope, cutoffSeq: state.head.coreSeq, kinds: ['image'] })).items.map(row => row.ref)).toEqual([source!.ref]);
  expect(state.records.find(row => row.domain === 'world')).toEqual(before.records.find(row => row.domain === 'world'));
  expect((await f.repo.queryKnowledge({ scope: state.head.scope, cutoffSeq: state.head.coreSeq })).items).toEqual([]);
  expect((await runCoreImageJob({ ...f.request, jobId }, f.deps)).kind).toBe('completed'); expect(f.generate).toHaveBeenCalledTimes(1);
  expect((await requestCoreImage(f.request, f.deps)).status).toBe('already_committed');
  await expect(requestCoreImage({ ...f.request, prompt: 'different' }, f.deps)).rejects.toThrow('CORE2_IMAGE_REQUEST_CHANGED');
});
it('recovers saved image bytes after lost output acknowledgement and export/import without generating twice', async () => {
  const f = await fixture(), put = f.repo.putSource.bind(f.repo); let lost = false;
  vi.spyOn(f.repo, 'putSource').mockImplementation(async source => { const ref = await put(source); if (source.kind === 'image' && !lost) { lost = true; throw Error('TEST_IMAGE_OUTPUT_ACK_LOST'); } return ref; });
  const receipt = await requestCoreImage(f.request, f.deps); expect((await runCoreImageJob({ ...f.request, jobId: receipt.jobIds[0]! }, f.deps)).kind).toBe('failed');
  const pack = await prepareCoreImport(await exportCorePackage(f.repo, f.seed.head.scope)); await f.repo.importPrepared(pack);
  const head = await f.repo.readHead(pack.manifest.scope), job = pack.jobs.find(row => row.record.kind === 'image')!.record;
  const deps = { ...f.deps, getActiveSession: () => ({ scope: head.scope, sessionId: head.sessionId }) };
  expect((await runCoreImageJob({ scope: head.scope, sessionId: head.sessionId, jobId: job.jobId }, deps)).kind).toBe('completed'); expect(f.generate).toHaveBeenCalledTimes(1);
  const album = (await f.repo.readState(head.scope)).records.find(row => row.domain === 'album'); expect(album?.domain).toBe('album');
});
it('recovers bytes saved before a source-write failure without another image request', async () => {
  const f = await fixture(), put = f.repo.putSource.bind(f.repo); let failed = false;
  vi.spyOn(f.repo, 'putSource').mockImplementation(async source => { if (source.kind === 'image' && !failed) { failed = true; throw Error('TEST_IMAGE_SOURCE_NOT_WRITTEN'); } return put(source); });
  const receipt = await requestCoreImage(f.request, f.deps), input = { ...f.request, jobId: receipt.jobIds[0]! };
  expect((await runCoreImageJob(input, f.deps)).kind).toBe('failed');
  const pack = await prepareCoreImport(await exportCorePackage(f.repo, f.seed.head.scope)); expect(pack.assets).toHaveLength(1);
  expect((await runCoreImageJob(input, f.deps)).kind).toBe('completed'); expect(f.generate).toHaveBeenCalledTimes(1);
  const photo = (await f.repo.readState(f.seed.head.scope)).records.find(row => row.domain === 'album'); if (photo?.domain !== 'album') throw Error('missing photo');
  expect((await f.repo.readSource(photo.value.sourceRefs[0]!))?.blocks[0]?.text).toContain('recovered_request');
});
it('does not save or publish a late image after the owning session is detached', async () => {
  const f = await fixture(); let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.generate.mockImplementation(async () => { enter(); await held; return { bytes: png(), mimeType: 'image/png', finalPrompt: 'Amber', finalNegative: '' }; });
  const receipt = await requestCoreImage(f.request, f.deps), work = runCoreImageJob({ ...f.request, jobId: receipt.jobIds[0]! }, f.deps); await entered; f.detach(); release();
  expect((await work).kind).toBe('conflict'); expect((await f.repo.readState(f.seed.head.scope)).records.filter(row => row.domain === 'album')).toEqual([]);
  expect((await f.repo.readExportRecords(f.seed.head.scope)).assets).toEqual([]);
});
it('does not generate twice after the image bytes acknowledgement is lost and concurrent retries race', async () => {
  const f = await fixture(), write = f.repo.publishAsset.bind(f.repo); let lost = false;
  vi.spyOn(f.repo, 'publishAsset').mockImplementation(async asset => { const result = await write(asset); if (!lost) { lost = true; throw Error('TEST_IMAGE_BYTES_ACK_LOST'); } return result; });
  const receipt = await requestCoreImage(f.request, f.deps), input = { ...f.request, jobId: receipt.jobIds[0]! };
  await runCoreImageJob(input, f.deps);
  const results = await Promise.all([runCoreImageJob(input, f.deps), runCoreImageJob(input, f.deps)]);
  expect(results.some(result => result.kind === 'completed')).toBe(true);
  expect(f.generate).toHaveBeenCalledTimes(1); expect((await f.repo.readState(f.seed.head.scope)).records.filter(row => row.domain === 'album')).toHaveLength(1);
});
it('rejects old English facts when the player edits the character while image generation is in flight', async () => {
  const f = await fixture(); let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.generate.mockImplementation(async () => { enter(); await held; return { bytes: png(), mimeType: 'image/png', finalPrompt: 'Amber', finalNegative: '' }; });
  const { createCoreController } = await import('@/core/settlement/coreController');
  const controller = createCoreController({ repo: f.repo, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: async () => '' }) });
  try {
    await controller.attach({ scope: f.seed.head.scope }); const owner = controller.getView().snapshot!.head;
    const request = { ...f.request, sessionId: owner.sessionId }, deps = { ...f.deps, getActiveSession: () => ({ scope: owner.scope, sessionId: owner.sessionId }) };
    const receipt = await requestCoreImage(request, deps), work = runCoreImageJob({ ...request, jobId: receipt.jobIds[0]! }, deps); await entered;
    await controller.command({ type: 'edit_npc', npcId: 'npc-amber', field: 'appearance', value: '棕色长发，绿色眼睛' }); release();
    const result = await work; expect(result.kind).toBe('failed'); expect(result.detail).toContain('CORE2_IMAGE_ENGLISH_MISMATCH');
    expect((await f.repo.readExportRecords(owner.scope)).assets).toEqual([]); expect((await f.repo.readState(owner.scope)).records.filter(row => row.domain === 'album')).toEqual([]);
  } finally { release(); controller.dispose(); }
});
}
