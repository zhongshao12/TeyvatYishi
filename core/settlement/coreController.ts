import type { CoreRepository } from '../contracts/storage';
import type { BasicPlayerCommand } from './actions';
import type { CoreGameController, CoreControllerOptions } from '../view/coreGameController';
import { createCoreGameController } from '../view/coreGameController';
import { freezeSource } from '../sources/sourceRecords';
import { stableJson, sameData } from '../persistence/repositoryValidation';
import type { MemoryModelDependencies } from '../memory/turnSummary';
import { createCoreMemoryRuntime } from '../jobs/memoryRuntime';
import { prepareCoreMaintenance, restoreBoundMaintenancePlan } from '../memory/maintenanceEntry';
import type { MaintenancePlan } from '../memory/maintenancePlan';
import { readCoreJob, readCurrentCoreJobAttempt, type JobRunResult } from '../jobs/jobRunner';
import { editCoreMemory, resumeCoreManualEdit, type MemoryEditAction } from '../memory/manualEdits';
import type { DerivedReceipt } from '../contracts/memory';
import { createCorePhoneRuntime } from '../jobs/phoneRuntime';
import type { CorePhoneJobDependencies } from '../jobs/phoneJob';
import { sendCorePhoneMessage, type CorePhoneSend } from './phoneActions';
import type { CommitReceipt } from '../contracts/operation';
import { prepareCoreCourierRetry } from '../jobs/courierRecovery';
import type { Talent } from '@/models/teyvat/character';
import type { CoreStoryResources } from '../content/storyContext';
import type { CoreStoryNode } from '../content/storyCatalog';
import type { CoreCodexCatalog, CoreCodexEntry } from '../content/codexCatalog';
import { bindCoreOpeningResources } from '../content/openingResources';
import { createCoreNewsRuntime } from '../jobs/newsRuntime';
import { requestCoreNews, type CoreNewsModels } from '../jobs/newsJob';
import { publishCoreUploadedImage, type CoreImageUpload } from './imagePublication';
import { createCoreImageRuntime } from '../jobs/imageRuntime';
import { requestCoreImage, type CoreImageModels, type CoreImageRequest, type CoreImagePreparation } from '../jobs/imageJob';
import { ownCoreImageRequest } from '../jobs/imagePlan';
import type { ImagePromptLibraryStore } from '@/utils/createImagePromptLibraryStore';
import { validateCorePhoneImageOrigin } from '../retrieval/phonePhotoContext';
import type { CoreProfileCatalog } from '../content/profileCatalog';
import { createCoreProfileRuntime } from '../jobs/profileRuntime';
import { requestCoreProfile } from './profileCompletion';
import { CORE_COMMAND_ENTRIES } from '../view/writeEntrypoints';

export interface CoreControllerDependencies extends CoreControllerOptions { repo: CoreRepository; memoryModels?: MemoryModelDependencies; phoneModels?: Pick<CorePhoneJobDependencies, 'generate' | 'getModelIdentity'>; newsModels?: CoreNewsModels; imageModels?: CoreImageModels; imagePromptLibrary?: ImagePromptLibraryStore; storyResources?: CoreStoryResources; contentCatalog?: CoreCodexCatalog; profileCatalog?: CoreProfileCatalog }
export interface CoreMaintenancePreview { token: string; turns: number[]; modelRequests: number; description: string }
export interface CoreController extends CoreGameController {
  command(command: BasicPlayerCommand, operationId?: string): ReturnType<CoreGameController['execute']>;
  previewMaintenance(mode: 'compress' | 'rebuild', memoryIds: string[]): Promise<CoreMaintenancePreview>;
  runMaintenance(token: string): Promise<JobRunResult>;
  retryJob(jobId: string): Promise<JobRunResult>;
  stopJob(jobId: string): Promise<void>;
  editMemory(input: Pick<MemoryEditAction, 'memoryId' | 'expectedVersion' | 'text' | 'pinned' | 'importance'>): Promise<DerivedReceipt>;
  sendPhone(input: CorePhoneSend): Promise<CommitReceipt>;
  requestNews(operationId?: string): Promise<CommitReceipt>;
  requestImage(input: CoreImageRequest & { operationId?: string }): Promise<CommitReceipt>;
  prepareImage(input: CoreImagePreparation, signal?: AbortSignal): Promise<CoreImageRequest>;
  getImagePromptLibrary(): ImagePromptLibraryStore | undefined;
  uploadImage(input: CoreImageUpload & { operationId?: string }): Promise<CommitReceipt>;
  getTalentTemplates(): Talent[];
  readStoryCatalog(signal?: AbortSignal): Promise<CoreStoryNode[]>;
  getCurrentStoryTitle(): string;
  readCodex(signal?: AbortSignal): Promise<CoreCodexEntry[]>;
  waitForBackground(): Promise<void>;
  completeNpcProfile(npcId: string): Promise<CommitReceipt>;
}
/** Coordination only. Domain rules, repository commits and query projections retain ownership. */
export function createCoreController({ repo, memoryModels, phoneModels, newsModels, imageModels, imagePromptLibrary, storyResources, contentCatalog, profileCatalog, ...options }: CoreControllerDependencies): CoreController {
  const base = createCoreGameController(repo, { autoSave: true, ...options, turnDependencies: () => {
    const dependencies = options.turnDependencies(), interval = newsModels?.getAutomaticInterval?.();
    return { ...dependencies, completePublicProfiles: !!profileCatalog, courierModelIdentity: () => phoneModels?.getModelIdentity() ?? 'unconfigured',
      ...(interval ? { newsSchedule: { intervalTurns: interval, modelIdentity: newsModels?.getModelIdentity() ?? 'unconfigured' } } : {}) };
  } });
  const previews = new Map<string, MaintenancePlan>();
  let navigationVersion = 0;
  const getActiveSession = () => { const view = base.getView(); return view.snapshot && !view.readOnly ? { scope: view.snapshot.head.scope, sessionId: view.snapshot.head.sessionId } : null; };
  const profile = createCoreProfileRuntime({ repo, catalog: { read: (identity, signal) => profileCatalog?.read(identity, signal) ?? Promise.reject(Error('公开档案资料未配置，未补造人物信息。')) }, getActiveSession, onChange: base.refreshExternal });
  const newsPort: CoreNewsModels = { generate: (snapshot, signal) => newsModels?.generate(snapshot, signal) ?? Promise.reject(Error('蒸汽鸟报独立模型未配置，未调用正文或伪造简报。')), getModelIdentity: () => newsModels?.getModelIdentity() ?? 'unconfigured' };
  const imagePort: CoreImageModels = { generate: (request, signal) => imageModels?.generate(request, signal) ?? Promise.reject(Error('生图接口尚未配置，未生成图片。')), getModelIdentity: () => imageModels?.getModelIdentity() ?? 'unconfigured' };
  const image = createCoreImageRuntime({ repo, models: imagePort, getActiveSession, onChange: base.refreshExternal,
    async onCommitted(scope, sessionId) { if (options.autoSave !== false && sameData(getActiveSession(), { scope, sessionId })) try { await base.saveAutomatic(); } catch { /* The saved image survives an independent autosave failure. */ } },
  });
  const news = createCoreNewsRuntime({ repo, models: newsPort, getActiveSession, onChange: base.refreshExternal,
    async onCommitted(scope, sessionId) { if (options.autoSave !== false && sameData(getActiveSession(), { scope, sessionId })) try { await base.saveAutomatic(); } catch { /* Independent save failures remain visible. */ } },
  });
  const memory = createCoreMemoryRuntime({ repo, models: memoryModels ?? {}, onChange: base.refreshDerived, getSettings: () => options.turnDependencies().summarySettings ?? { mode: 'local', shortThreshold: 15, middleThreshold: 15, longThreshold: 15, prompt: '' }, getActiveSession: () => { const view = base.getView(); return view.snapshot && !view.readOnly ? { scope: view.snapshot.head.scope, sessionId: view.snapshot.head.sessionId } : null; } });
  const phone = createCorePhoneRuntime({ repo, ...options.turnDependencies(), contentCatalog, getActiveSession, onChange: base.refreshExternal,
    getSettlementDependencies: () => ({ ...options.turnDependencies(), contentCatalog }),
    generate: request => phoneModels?.generate(request) ?? Promise.reject(Error('手机回复 API 未配置；玩家消息已保存，可在配置后重试。')),
    getModelIdentity: () => phoneModels?.getModelIdentity() ?? 'unconfigured',
    async onCommitted(receipt, sessionId) {
      if (receipt.status !== 'committed' && receipt.status !== 'already_committed') return;
      for (const jobId of receipt.jobIds) void memory.summarize(receipt.scope, sessionId, jobId).catch(() => undefined);
      if (options.autoSave !== false && sameData(getActiveSession(), { scope: receipt.scope, sessionId })) {
        try { await base.saveAutomatic(); } catch { /* Core data is committed; the independent autosave error is visible and retryable. */ }
      }
    },
  });
  const schedule = async (receipt: CommitReceipt, sessionId: string) => {
    if (receipt.status !== 'committed' && receipt.status !== 'already_committed') return;
    for (const jobId of receipt.jobIds) {
      const job = await readCoreJob(repo, receipt.scope, jobId);
      if (job?.kind === 'profile') void profile.run(receipt.scope, sessionId, jobId).catch(() => undefined);
      else if (job?.kind === 'courier') void phone.reply(receipt.scope, sessionId, jobId).catch(() => undefined);
      else if (job?.kind === 'news') void news.run(receipt.scope, sessionId, jobId).catch(() => undefined);
      else if (job?.kind === 'image') void image.run(receipt.scope, sessionId, jobId).catch(() => undefined);
      else if (job?.kind === 'turn_summary') void memory.summarize(receipt.scope, sessionId, jobId).catch(() => undefined);
    }
  };
  const restoreStoryView = async () => {
    const snapshot = base.getView().snapshot, story = snapshot?.records.find(row => row.domain === 'story');
    if (!snapshot || !storyResources || story?.domain !== 'story' || !story.value.seriesId) return;
    const current = () => { const next = base.getView().snapshot; return next && sameData(next.head.scope, snapshot.head.scope) && next.head.sessionId === snapshot.head.sessionId; };
    try { await storyResources.prepare(snapshot); if (current()) await base.refreshDerived(); }
    catch (error) { if (current()) throw error; }
  };
  const controller: CoreController = { ...base,
    async completeNpcProfile(npcId) { const owner = getActiveSession(); if (!owner || base.getView().busy || !profileCatalog) throw Error('公开档案补全尚未就绪。'); const receipt = await requestCoreProfile({ ...owner, npcId, operationId: `profile-request-${crypto.randomUUID()}` }, { repo, getActiveSession }); await schedule(receipt, owner.sessionId); return receipt; },
    getImagePromptLibrary: () => imagePromptLibrary,
    async prepareImage(input, signal) {
      const owner = getActiveSession(), snapshot = base.getView().snapshot; if (!owner || !snapshot || base.getView().busy) throw Error('CORE2_COMMAND_NOT_READY');
      if (!imageModels?.prepare) throw Error('尚未配置图片提示词准备接口。');
      if (input.phoneOrigin) await validateCorePhoneImageOrigin(snapshot, input.phoneOrigin, input.npcId ? [input.npcId] : [], repo);
      const identity = imagePort.getModelIdentity(), result = await imageModels.prepare(structuredClone(snapshot), structuredClone(input), signal);
      if (signal?.aborted || !sameData(getActiveSession(), owner) || imagePort.getModelIdentity() !== identity) throw Error('存档或生图设置已经改变，未使用迟到的提示词。');
      const request = ownCoreImageRequest(result.request);
      if (result.cache) {
        const npc = snapshot.records.find(row => row.domain === 'npc' && row.entityId === result.cache!.npcId);
        if (npc?.domain !== 'npc' || !sameData(npc.value.visualArchive.englishFacts, result.cache.value)) await controller.command({ type: 'image_profile_cache', npcId: result.cache.npcId, expectedVersion: result.cache.expectedVersion, cache: JSON.parse(JSON.stringify(result.cache.value)) });
      }
      if (signal?.aborted || !sameData(getActiveSession(), owner)) throw Error('图片准备已取消。'); return request;
    },
    async requestImage(input) {
      const owner = getActiveSession(); if (!owner || base.getView().busy) throw Error('CORE2_COMMAND_NOT_READY');
      const { operationId = crypto.randomUUID(), ...request } = structuredClone(input);
      const receipt = await requestCoreImage({ ...request, ...owner, operationId }, { repo, models: imagePort, getActiveSession });
      if (sameData(getActiveSession(), owner)) await base.refreshExternal(); await schedule(receipt, owner.sessionId); return receipt;
    },
    async uploadImage(input) {
      const owner = getActiveSession(); if (!owner || base.getView().busy) throw Error('CORE2_COMMAND_NOT_READY');
      const receipt = await publishCoreUploadedImage({ ...input, ...owner, operationId: input.operationId ?? crypto.randomUUID() }, { repo, getActiveSession });
      if (sameData(getActiveSession(), owner)) {
        await base.refreshExternal();
        if (options.autoSave !== false && ['committed', 'already_committed'].includes(receipt.status)) try { await base.saveAutomatic(); } catch { /* The image is saved; the independent autosave failure remains visible. */ }
      }
      return receipt;
    },
    async readCodex(signal) {
      const owner = base.getView().snapshot?.head; if (!owner || !contentCatalog) throw Error('当前运行入口未配置提瓦特图鉴。');
      const rows = await contentCatalog.read(signal), current = base.getView().snapshot?.head;
      if (signal?.aborted || !current || !sameData(owner.scope, current.scope) || owner.sessionId !== current.sessionId) throw Error('CORE2_CODEX_VIEW_CHANGED');
      return rows;
    },
    async readStoryCatalog(signal) {
      const before = base.getView().snapshot; if (!before) throw Error('CORE2_COMMAND_NOT_READY');
      if (!storyResources) throw Error('当前运行入口未配置剧情资料。');
      const prepared = await storyResources.prepare(before, signal), after = base.getView().snapshot;
      if (signal?.aborted || !after || !sameData(before.head.scope, after.head.scope) || before.head.sessionId !== after.head.sessionId
        || before.records.find(row => row.domain === 'story')?.version !== after.records.find(row => row.domain === 'story')?.version) throw Error('CORE2_STORY_VIEW_CHANGED');
      return structuredClone(prepared.catalog);
    },
    getCurrentStoryTitle() {
      const story = base.getView().snapshot?.records.find(row => row.domain === 'story');
      if (story?.domain !== 'story' || !story.value.nodeId) return '尚未启程';
      const node = storyResources?.getNodes(base.getView().snapshot ?? undefined).find(row => row.seriesId === story.value.seriesId && row.nodeId === story.value.nodeId);
      return node ? [node.seriesTitle, node.chapterTitle, node.title].filter(Boolean).join(' · ') : `章节资料尚未加载（${story.value.nodeId}）`;
    },
    getTalentTemplates() { const traveler = base.getView().snapshot?.records.find(row => row.domain === 'traveler'); return [...new Map([...(traveler?.domain === 'traveler' ? traveler.value.天赋 : []), ...(options.turnDependencies().rulePolicy.talents ?? [])].map(talent => [talent.id, structuredClone(talent)])).values()]; },
    async initialize(seed) { const token = ++navigationVersion, prepared = await bindCoreOpeningResources(seed, storyResources); if (token !== navigationVersion) throw Error('CORE2_OPENING_NAVIGATION_CHANGED'); previews.clear(); memory.cancelAll(); phone.cancelAll(); news.cancelAll(); image.cancelAll(); profile.cancelAll(); const head = await base.initialize(prepared); if (token !== navigationVersion) throw Error('CORE2_OPENING_NAVIGATION_CHANGED'); await restoreStoryView(); return head; },
    async attach(pointer) { ++navigationVersion; previews.clear(); memory.cancelAll(); phone.cancelAll(); news.cancelAll(); image.cancelAll(); profile.cancelAll(); const head = await base.attach(pointer); await restoreStoryView(); return head; },
    async restore(id) { ++navigationVersion; previews.clear(); memory.cancelAll(); phone.cancelAll(); news.cancelAll(); image.cancelAll(); profile.cancelAll(); const head = await base.restore(id); await restoreStoryView(); return head; },
    dispose() { ++navigationVersion; previews.clear(); memory.cancelAll(); phone.cancelAll(); news.cancelAll(); image.cancelAll(); profile.cancelAll(); base.dispose(); },
    async requestNews(operationId = crypto.randomUUID()) {
      const owner = getActiveSession(); if (!owner || base.getView().busy) throw Error('CORE2_COMMAND_NOT_READY');
      const receipt = await requestCoreNews({ ...owner, operationId }, { repo, models: newsPort, getActiveSession });
      if (sameData(getActiveSession(), owner)) await base.refreshExternal(); await schedule(receipt, owner.sessionId); return receipt;
    },
    async sendPhone(input) {
      const owner = getActiveSession(); if (!owner) throw Error('CORE2_COMMAND_NOT_READY');
      const receipt = await sendCorePhoneMessage({ ...input, ...owner, modelIdentity: phoneModels?.getModelIdentity() ?? 'unconfigured' }, { repo, ...options.turnDependencies(), getActiveSession });
      if (sameData(getActiveSession(), owner)) await base.refreshExternal();
      await schedule(receipt, owner.sessionId); return receipt;
    },
    async previewMaintenance(mode, memoryIds) {
      const view = base.getView(); if (!view.snapshot || view.readOnly) throw Error('CORE2_COMMAND_NOT_READY');
      const head = view.snapshot.head, prepared = await prepareCoreMaintenance({ scope: head.scope, sessionId: head.sessionId, mode, selectedMemoryIds: memoryIds,
        settings: options.turnDependencies().summarySettings ?? { mode: 'local', shortThreshold: 15, middleThreshold: 15, longThreshold: 15, prompt: '' } }, { repo,
        getActiveSession: () => { const current = base.getView(); return current.snapshot && !current.readOnly ? current.snapshot.head : null; } });
      const token = crypto.randomUUID(); while (previews.size >= 8) previews.delete(previews.keys().next().value!);
      previews.set(token, prepared.plan); return { token, turns: prepared.turns, modelRequests: prepared.modelRequests, description: prepared.description };
    },
    async runMaintenance(token) {
      const plan = previews.get(token); previews.delete(token);
      const head = base.getView().snapshot?.head;
      if (!plan || !head || base.getView().readOnly || !sameData(head.scope, plan.scope) || head.sessionId !== plan.sessionId) throw Error('CORE2_MAINTENANCE_PREVIEW_EXPIRED');
      return memory.maintain(plan);
    },
    async retryJob(jobId) {
      const owner = getActiveSession(); if (!owner) throw Error('CORE2_COMMAND_NOT_READY');
      const job = await readCurrentCoreJobAttempt(repo, owner.scope, jobId); if (!job) throw Error('CORE2_JOB_NOT_FOUND');
      if (job.kind === 'news') return news.retry(owner.scope, owner.sessionId, job.jobId);
      if (job.kind === 'image') return image.retry(owner.scope, owner.sessionId, job.jobId);
      if (job.kind === 'profile') return profile.retry(owner.scope, owner.sessionId, job.jobId);
      if (job.kind === 'manual_memory') { const result = await resumeCoreManualEdit(repo, job, owner.sessionId, { ...options.turnDependencies(), getActiveSession }); if (sameData(getActiveSession(), owner)) await base.refreshDerived(); return result; }
      if (job.kind === 'courier') return phone.reply(owner.scope, owner.sessionId, await prepareCoreCourierRetry(repo, job, owner.sessionId, phoneModels?.getModelIdentity() ?? 'unconfigured'));
      if (job.kind === 'compression' || job.kind === 'rebuild') {
        const plan = restoreBoundMaintenancePlan(job, owner.sessionId);
        return memory.maintain(job.status === 'cancelled' && job.publicationReceipt?.status !== 'published' ? { ...plan, jobId: `memory-job-${crypto.randomUUID()}`, reuseJobId: job.jobId } : plan);
      }
      if (job.kind === 'turn_summary') {
        if (job.status === 'cancelled' && job.publicationReceipt?.status !== 'published') {
          const replacement = { ...job, jobId: `summary-job-${crypto.randomUUID()}`, retryOfJobId: job.jobId, sessionId: owner.sessionId, status: 'pending' as const, leaseId: null, attempts: 0, steps: [], version: 1 };
          delete replacement.failure; delete replacement.publicationReceipt;
          await repo.enqueueJob(replacement); return memory.summarize(owner.scope, owner.sessionId, replacement.jobId);
        }
        return memory.summarize(owner.scope, owner.sessionId, job.jobId);
      }
      throw Error('此任务尚未注册恢复入口，未重新调用模型。');
    },
    async stopJob(jobId) { const owner = getActiveSession(); if (!owner) throw Error('CORE2_COMMAND_NOT_READY'); const job = await readCurrentCoreJobAttempt(repo, owner.scope, jobId); if (!job) throw Error('CORE2_JOB_NOT_FOUND'); if (job.kind === 'courier') await phone.stop(owner.scope, job.jobId); else if (job.kind === 'news') await news.stop(owner.scope, job.jobId); else if (job.kind === 'image') await image.stop(owner.scope, job.jobId); else if (job.kind === 'profile') await profile.stop(owner.scope, job.jobId); else await memory.stop(owner.scope, job.jobId); },
    async editMemory(input) {
      const owner = getActiveSession(); if (!owner || base.getView().busy) throw Error('CORE2_COMMAND_NOT_READY');
      const receipt = await editCoreMemory(repo, { ...input, ...owner, operationId: `memory-edit-${crypto.randomUUID()}`, jobId: `memory-edit-job-${crypto.randomUUID()}` }, { ...options.turnDependencies(), getActiveSession });
      if (sameData(getActiveSession(), owner)) await base.read();
      return receipt;
    },
    async send(input) {
      const result = await base.send(input);
      if (result.kind === 'committed' || result.kind === 'pending') await schedule(result.receipt, input.sessionId);
      return result;
    },
    async retry(operationId) {
      const owner = base.getView().snapshot?.head;
      const result = await base.retry(operationId);
      if (owner && (result.kind === 'committed' || result.kind === 'pending')) await schedule(result.receipt, owner.sessionId);
      return result;
    },
    async waitForBackground() { await phone.wait(); await news.wait(); await image.wait(); await profile.wait(); await memory.wait(); },
    async command(input, operationId = crypto.randomUUID()) {
    const command = structuredClone(input), view = base.getView();
    if (command.type === 'memory_edit') throw Error('请使用记忆编辑入口；只登记操作不会完成记忆发布。');
    if (command.type === 'message') throw Error('请使用手机发送入口；只登记指令不会投递消息或安排回信。');
    const route = CORE_COMMAND_ENTRIES[command.type];
    if (!route || route.method !== 'command') throw Error(`请使用${route?.feature ?? '已登记操作'}入口；不能通过原始指令绕过发布、版本或任务保护。`);
    if (!view.snapshot || view.busy || view.readOnly) throw Error('CORE2_COMMAND_NOT_READY');
    const head = view.snapshot.head, snapshot = await repo.readState(head.scope);
    const current = base.getView().snapshot;
    if (snapshot.head.sessionId !== head.sessionId || !current || !sameData(current.head.scope, head.scope)) throw Error('CORE2_SESSION_CHANGED');
    const prior = await repo.readOperation(head.scope, operationId), saved = prior?.sourceRefs.length === 1 ? await repo.readSource(prior.sourceRefs[0]!) : null;
    if (prior && (!saved || saved.kind !== 'manual' || saved.blocks.length !== 1 || saved.blocks[0]!.text !== stableJson(command))) throw Error('CORE2_OPERATION_SOURCE_MISMATCH');
    const world = snapshot.records.find(row => row.domain === 'world'); if (world?.domain !== 'world') throw Error('CORE2_WORLD_MISSING');
    const source = saved ?? freezeSource({ scope: head.scope, operationId, kind: 'manual', moment: world.value.moment, blocks: [{ blockId: 'command', kind: 'configuration', text: stableJson(command) }] });
    const receipt = await base.execute({ kind: 'player', actionId: operationId, source, command });
    if (!['committed', 'already_committed'].includes(receipt.status)) throw Error(`CORE2_COMMAND_NOT_COMMITTED: ${'reason' in receipt ? receipt.reason : receipt.status}`);
    await schedule(receipt, head.sessionId);
    return receipt;
  } };
  return controller;
}
