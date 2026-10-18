import type { CoreScope } from '../contracts/identity';
import type { CoreRepository } from '../contracts/storage';
import type { AlbumState, CoreSnapshot } from '../contracts/state';
import type { CoreJobRunInput } from './jobRunner';
import type { EnglishImageCharacterFacts } from '@/models/imageCharacterEnglish';
import type { JobRecord } from '../contracts/memory';
import type { SourceRecord } from '../contracts/event';
import type { StateRecord } from '../contracts/state';
import { readCoreJob, runCoreJob } from './jobRunner';
import { CORE_IMAGE_PLAN_PREFIX, ownCoreImageRequest, readCoreImagePlan, serializeCoreImagePlan } from './imagePlan';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { sameData, sameScope, stableJson } from '../persistence/repositoryValidation';
import { freezeSource } from '../sources/sourceRecords';
import { ownCoreImage } from '../assets/images';
import { publishCoreAsset } from '../persistence/assets';
import { commitHostPublication, hostPublicationEvent } from '../settlement/commitHostPublication';
import { validateCorePhoneImageOrigin, type CorePhoneImageOrigin } from '../retrieval/phonePhotoContext';
import { validateCoreImageCharacters } from '../retrieval/imageContext';

export interface CoreImageRequest { title: string; kind: AlbumState['kind']; npcIds: string[]; prompt: string; negative: string; size: string; characters: EnglishImageCharacterFacts[]; phoneOrigin?: CorePhoneImageOrigin }
export interface CoreImagePreparation { title: string; kind: AlbumState['kind']; npcId: string | null; userInput: string; positive: string[]; negative: string[]; size: string; phoneOrigin?: CorePhoneImageOrigin }
export interface CorePreparedImage { request: CoreImageRequest; cache?: { npcId: string; expectedVersion: number; value: import('@/models/imageCharacterEnglish').ImageCharacterEnglishCache } }
export interface CoreImageModels { getModelIdentity(): string; prepare?(snapshot: CoreSnapshot, input: CoreImagePreparation, signal?: AbortSignal): Promise<CorePreparedImage>; generate(request: CoreImageRequest, signal: AbortSignal): Promise<{ bytes: Uint8Array; mimeType: string; finalPrompt?: string; finalNegative?: string }> }
export interface CoreImageDependencies { repo: CoreRepository; models: CoreImageModels; getActiveSession(): { scope: CoreScope; sessionId: string } | null }
function anchorMatches(source: SourceRecord, job: JobRecord): boolean {
  try {
    const plan = readCoreImagePlan(job), text = source.blocks[0]?.text;
    if (!sameScope(source.scope, job.scope) || source.operationId !== job.operationId || source.kind !== 'manual' || source.blocks.length !== 1 || source.blocks[0]?.kind !== 'configuration' || !text?.startsWith(CORE_IMAGE_PLAN_PREFIX)) return false;
    // Original source text is immutable across package remapping; only the typed
    // job envelope owns executable IDs. Compare its validated visual payload.
    const raw = JSON.parse(text.slice(CORE_IMAGE_PLAN_PREFIX.length));
    const original = readCoreImagePlan({ ...job, scope: raw.scope, operationId: raw.anchorOperationId, configFingerprint: text });
    return sameData(original.request, plan.request);
  } catch { return false; }
}
export async function requestCoreImage(input: CoreImageRequest & { scope: CoreScope; sessionId: string; operationId: string }, deps: CoreImageDependencies): Promise<import('../contracts/operation').CommitReceipt> {
  const { scope, sessionId, operationId, ...raw } = structuredClone(input), request = ownCoreImageRequest(raw);
  const head = await deps.repo.readHead(scope);
  if (head.sessionId !== sessionId || !sameData(deps.getActiveSession(), { scope, sessionId })) throw Error('CORE2_IMAGE_SESSION_CHANGED');
  const key = checksumUtf8(stableJson([scope, operationId])), sourceRef = { sourceId: 'image-request-' + key, sourceVersion: 1 }, jobId = 'image-job-' + key;
  const saved = await deps.repo.readSource(sourceRef), prior = await deps.repo.readOperation(scope, operationId);
  if (prior?.status === 'committed' && prior.receipt) {
    const job = await readCoreJob(deps.repo, scope, jobId);
    if (!job || !saved || prior.kind !== 'manual' || !sameData(prior.sourceRefs, [sourceRef]) || !prior.receipt.jobIds.includes(jobId) || !anchorMatches(saved, job)) throw Error('CORE2_IMAGE_OPERATION_ID_REUSED');
    if (!sameData(readCoreImagePlan(job).request, request)) throw Error('CORE2_IMAGE_REQUEST_CHANGED');
    return { ...prior.receipt, status: 'already_committed' };
  }
  const state = await deps.repo.readState(scope), world = state.records.find(row => row.domain === 'world'); if (world?.domain !== 'world') throw Error('CORE2_WORLD_MISSING');
  if (request.phoneOrigin) await validateCorePhoneImageOrigin(state, request.phoneOrigin, request.npcIds, deps.repo);
  validateCoreImageCharacters(state, request);
  const people = request.npcIds.map(id => { const npc = state.records.find(row => row.domain === 'npc' && row.entityId === id); if (npc?.domain !== 'npc' || npc.value.archived) throw Error('CORE2_IMAGE_CHARACTER_MISSING'); return npc; });
  const fingerprint = serializeCoreImagePlan({ version: 1, scope, anchorOperationId: operationId, publicationOperationId: 'image-publication-' + key, entryId: 'image-generated-entry-' + key,
    assetId: 'image-generated-asset-' + key, outputSourceRef: { sourceId: 'image-output-' + key, sourceVersion: 1 }, modelIdentity: deps.models.getModelIdentity(), request });
  if (saved && (saved.operationId !== operationId || saved.kind !== 'manual' || saved.blocks.length !== 1 || saved.blocks[0]?.text !== fingerprint)) throw Error('CORE2_IMAGE_REQUEST_CHANGED');
  const source = saved ?? { ...freezeSource({ scope, operationId, kind: 'manual', moment: world.value.moment, blocks: [{ blockId: 'image-request', kind: 'configuration', text: fingerprint }] }), ref: sourceRef };
  const job: JobRecord = { jobId, scope, sessionId, kind: 'image', operationId, sourceRefs: [sourceRef], configFingerprint: fingerprint, status: 'pending', leaseId: null, attempts: 0, steps: [], version: 1 };
  return commitHostPublication(deps.repo, source, { sessionId, readSet: people.map(npc => ({ domain: 'npc', entityId: npc.entityId, version: npc.version })), changes: [], events: [], jobs: [job] });
}
export async function runCoreImageJob(input: CoreJobRunInput, deps: CoreImageDependencies): Promise<import('./jobRunner').JobRunResult> {
  const job = await readCoreJob(deps.repo, input.scope, input.jobId); if (!job) throw Error('CORE2_IMAGE_JOB_MISSING');
  const plan = readCoreImagePlan(job), source = await deps.repo.readSource(job.sourceRefs[0]!);
  if (!source || !anchorMatches(source, job)) throw Error('CORE2_IMAGE_REQUEST_SOURCE');
  const current = async (signal: AbortSignal, leaseId: string | null, model = false) => {
    const head = await deps.repo.readHead(input.scope), live = await readCoreJob(deps.repo, input.scope, input.jobId);
    if (signal.aborted || head.sessionId !== input.sessionId || !sameData(deps.getActiveSession(), { scope: input.scope, sessionId: input.sessionId }) || live?.status !== 'running' || live.leaseId !== leaseId) throw Error('CORE2_IMAGE_CANCELLED');
    if (model && deps.models.getModelIdentity() !== plan.modelIdentity) throw Error('图片接口已改变，请显式重试；没有混用旧结果。');
    if (model) validateCoreImageCharacters(await deps.repo.readState(input.scope), plan.request);
  };
  const validateOutput = async (output: SourceRecord) => {
    if (output.kind !== 'image' || !sameScope(output.scope, input.scope) || output.operationId !== plan.publicationOperationId || !sameData(output.ref, plan.outputSourceRef)
      || !sameData(output.assetRefs, [plan.assetId]) || output.blocks.length !== 1 || output.blocks[0]?.kind !== 'message' || output.blocks[0]?.speakerId) throw Error('CORE2_IMAGE_OUTPUT_BINDING');
    const data: unknown = JSON.parse(output.blocks[0].text);
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 5 || !Object.keys(data).every(key => ['mode', 'title', 'kind', 'prompt', 'negative'].includes(key))) throw Error('CORE2_IMAGE_OUTPUT_INVALID');
    const value = data as { mode: string; title: string; kind: string; prompt: string; negative: string };
    if (!['generated', 'recovered_request'].includes(value.mode) || value.title !== plan.request.title || value.kind !== plan.request.kind || typeof value.prompt !== 'string' || !value.prompt.trim() || typeof value.negative !== 'string'
      || value.mode === 'recovered_request' && (value.prompt !== plan.request.prompt || value.negative !== plan.request.negative)) throw Error('CORE2_IMAGE_OUTPUT_INVALID');
    const asset = await deps.repo.readAsset(plan.assetId); if (!asset || !sameScope(asset.scope, input.scope)) throw Error('CORE2_IMAGE_OUTPUT_MISSING'); ownCoreImage(asset.bytes, asset.mimeType);
  };
  return runCoreJob(input, { repo: deps.repo, getActiveSession: deps.getActiveSession, handlers: { image: { fingerprint: job.configFingerprint, steps: [{ stepId: 'generate-image-v1', run: async ({ signal, job: owned }) => {
    if ((await deps.repo.readOperation(input.scope, plan.publicationOperationId))?.status === 'committed') return [];
    const saved = await deps.repo.readSource(plan.outputSourceRef); if (saved) { await validateOutput(saved); return []; }
    await current(signal, owned.leaseId);
    let asset = await deps.repo.readAsset(plan.assetId), prompt = plan.request.prompt, negative = plan.request.negative, mode = 'recovered_request';
    if (!asset) {
      await current(signal, owned.leaseId, true);
      const generated = await deps.models.generate(structuredClone(plan.request), signal); await current(signal, owned.leaseId, true);
      const image = ownCoreImage(generated.bytes, generated.mimeType);
      asset = { ...image, assetId: plan.assetId, scope: input.scope };
      await publishCoreAsset(deps.repo, { scope: input.scope, sessionId: input.sessionId, asset }); await current(signal, owned.leaseId);
      prompt = generated.finalPrompt ?? prompt; negative = generated.finalNegative ?? negative; mode = 'generated';
    }
    const output = { ...freezeSource({ scope: input.scope, operationId: plan.publicationOperationId, kind: 'image', moment: source.moment,
      assetRefs: [plan.assetId], blocks: [{ blockId: 'image', kind: 'message', text: stableJson({ mode, title: plan.request.title, kind: plan.request.kind, prompt, negative }) }] }), ref: plan.outputSourceRef };
    await validateOutput(output); await current(signal, owned.leaseId); await deps.repo.putSource(output); return [];
  } }], finalize: async ({ signal, job: owned }) => {
    if ((await deps.repo.readOperation(input.scope, plan.publicationOperationId))?.status === 'committed') return;
    const output = await deps.repo.readSource(plan.outputSourceRef); if (!output) throw Error('CORE2_IMAGE_OUTPUT_MISSING'); await validateOutput(output); await current(signal, owned.leaseId);
    const row: StateRecord<'album'> = { scope: input.scope, domain: 'album', entityId: plan.entryId, version: 1, value: { entryId: plan.entryId, title: plan.request.title, kind: plan.request.kind,
      assetId: plan.assetId, sourceRefs: [output.ref], npcIds: plan.request.npcIds, moment: output.moment, ...(plan.request.phoneOrigin ? { phoneOrigin: plan.request.phoneOrigin } : {}) } };
    const change = { ref: { domain: 'album' as const, entityId: row.entityId, version: 0 }, before: null, after: row, effectKey: 'effect-' + row.entityId };
    const receipt = await commitHostPublication(deps.repo, output, { sessionId: input.sessionId, readSet: [change.ref], changes: [change], events: [hostPublicationEvent(output, 'publication.image', [change])], jobs: [],
      jobGuard: { jobId: owned.jobId, leaseId: owned.leaseId!, expectedVersion: owned.version, sourceRefs: owned.sourceRefs } });
    if (!['committed', 'already_committed'].includes(receipt.status)) throw Error('CORE2_IMAGE_PUBLICATION_' + receipt.status);
  } } } });
}
