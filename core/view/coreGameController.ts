import type { BranchHead, CoreScope, SourceRef } from '../contracts/identity';
import type { CoreRepository, SaveSlot, SaveSlotRequest } from '../contracts/storage';
import type { JourneySeed, CommitReceipt } from '../contracts/operation';
import type { CoreSnapshot } from '../contracts/state';
import type { SourceRecord, FactCandidate } from '../contracts/event';
import type { CoreAction } from '../settlement/actions';
import type { CoreTurnInput, CoreTurnResult, CoreTurnDependencies } from '../settlement/turnRunner';
import { runCoreTurn } from '../settlement/turnRunner';
import { settleCoreOperation } from '../settlement/settleOperation';
import { initializeCoreJourney } from '../settlement/initializeJourney';
import { saveSlot, saveAutomaticCoreTurn } from '../persistence/saveSlots';
import { sameScope, sourceRefKey } from '../persistence/repositoryValidation';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';
import { reviewPendingCandidate } from '../settlement/reviewActions';
import { projectCoreReceipt, type ReceiptViewModel } from '../settlement/receiptProjection';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { coreJobAttemptsPending, readCoreJobAttemptView } from '../jobs/jobAttemptView';

export interface CoreSessionPointer { scope: CoreScope; pendingOperationId?: string; manualSlotId?: string }
export interface CoreGameView { jobRevision: number }
export interface CoreGameView { autoSaveError?: string | null }
export interface CoreChatEntry { id: string; role: 'user' | 'assistant'; source: SourceRecord; status: 'committed' | 'pending' }
export interface CoreGameView { snapshot: CoreSnapshot | null; messages: CoreChatEntry[]; busy: boolean; readOnly: boolean; pendingOperationId: string | null; result: CoreTurnResult | null; error: string | null; lastSaved: SaveSlot | null; slots: SaveSlot[]; receipt: ReceiptViewModel | null; pendingReviews: { originOperationId: string; candidate: FactCandidate }[] }
export interface CoreControllerOptions {
  autoSave?: boolean;
  turnDependencies: () => Omit<CoreTurnDependencies, 'repo' | 'getActiveSession' | 'onSource'>;
  savePointer?: (pointer: CoreSessionPointer) => void | Promise<void>;
}
export interface CoreGameController {
  getView(): CoreGameView; subscribe(listener: () => void): () => void;
  initialize(seed: JourneySeed): Promise<BranchHead>; attach(pointer: CoreSessionPointer): Promise<BranchHead>;
  send(input: CoreTurnInput): Promise<CoreTurnResult>; retry(operationId: string): Promise<CoreTurnResult>; cancel(operationId: string): Promise<void>;
  save(input: SaveSlotRequest): Promise<SaveSlot>; restore(snapshotId: string): Promise<BranchHead>; read(): Promise<CoreSnapshot>; execute(action: CoreAction): Promise<CommitReceipt>; dispose(): void;
  saveAutomatic(): Promise<SaveSlot | null>;
  review(originOperationId: string, candidate: FactCandidate, decision: 'accept' | 'reject'): Promise<CommitReceipt>;
  refreshDerived(): Promise<void>;
  refreshExternal(): Promise<void>;
}

/** UI state is a disposable projection. Only the repository contains writable game truth. */
export function createCoreGameController(repo: CoreRepository, options: CoreControllerOptions): CoreGameController {
  let view: CoreGameView = { autoSaveError: null, jobRevision: 0, snapshot: null, messages: [], busy: false, readOnly: false, pendingOperationId: null, result: null, error: null, lastSaved: null, slots: [], receipt: null, pendingReviews: [] };
  let active: BranchHead | null = null, pointer: CoreSessionPointer | null = null, generation = 0, disposed = false;
  const listeners = new Set<() => void>(), aborts = new Map<string, AbortController>();
  const publish = (patch: Partial<CoreGameView>) => { if (!disposed) { view = { ...view, ...patch }; for (const listener of listeners) listener(); } };
  const errorText = (error: unknown) => sanitizeApiErrorReportText(error instanceof Error ? error.message : String(error));
  const requireActive = () => { if (!active || disposed) throw Error('CORE2_NO_ACTIVE_JOURNEY'); return active; };
  const navigation = async () => {
    if (pointer && options.savePointer) try { await options.savePointer(structuredClone(pointer)); } catch (error) { publish({ error: `游戏数据已保存，但恢复位置未能记住：${errorText(error)}` }); }
  };
  const entry = (source: SourceRecord, status: CoreChatEntry['status']): CoreChatEntry => ({ id: sourceRefKey(source.ref), role: source.kind === 'player_input' ? 'user' : 'assistant', source, status });
  const projection = async (head: BranchHead, snapshot: CoreSnapshot) => {
    const operations = await repo.queryCommittedOperations({ scope: head.scope, cutoffSeq: snapshot.head.coreSeq, afterSeq: 0, kinds: ['main'], direction: 'desc', limit: 20 });
    const rows = [...operations.items].reverse();
    if (pointer?.pendingOperationId) { const pending = await repo.readOperation(head.scope, pointer.pendingOperationId); if (pending && !rows.some(row => row.operationId === pending.operationId)) rows.push(pending); }
    const messages = new Map<string, CoreChatEntry>();
    for (const operation of rows) if (operation.kind === 'main') for (const ref of operation.sourceRefs) {
      const source = await repo.readSource(ref);
      if (source && ['player_input', 'narrative'].includes(source.kind)) messages.set(sourceRefKey(ref), entry(source, operation.status === 'committed' && (source.kind === 'player_input' || !operation.stage?.review.some(row => row.status !== 'verified')) ? 'committed' : 'pending'));
    }
    const pendingReviews = [];
    for (const operation of rows) for (const candidate of operation.stage?.candidates ?? []) if (['pending', 'disputed'].includes(candidate.status)) {
      const id = `event:review-${checksumUtf8(JSON.stringify([head.scope, operation.operationId, candidate.candidateId]))}`;
      if (!(await repo.queryEvents({ scope: head.scope, cutoffSeq: snapshot.head.coreSeq, eventIds: [id] })).items.length) pendingReviews.push({ originOperationId: operation.operationId, candidate });
    }
    const last = rows.filter(row => row.status === 'committed' && row.receipt).at(-1);
    let receipt = null;
    if (last?.receipt) {
      const events = await repo.queryEvents({ scope: head.scope, cutoffSeq: snapshot.head.coreSeq, eventIds: last.receipt.eventIds, limit: 200 });
      const jobs = await readCoreJobAttemptView(repo, head.scope, snapshot.head.coreSeq, last.receipt.jobIds);
      receipt = projectCoreReceipt(last.receipt, events.items, jobs);
    }
    return { messages: [...messages.values()].sort((a, b) => a.source.moment.turn - b.source.moment.turn || a.source.createdAt - b.source.createdAt || (a.role === 'user' ? -1 : 1)), pendingReviews, receipt };
  };
  const read = async () => {
    const head = requireActive(), token = generation;
    const snapshot = await repo.readState(head.scope);
    const [projected, slots] = await Promise.all([projection(head, snapshot), repo.listSaveSlots(head.scope.journeyId)]);
    const previous = view.snapshot;
    const newer = !previous || !sameScope(previous.head.scope, snapshot.head.scope) || snapshot.head.coreSeq > previous.head.coreSeq || snapshot.head.coreSeq === previous.head.coreSeq && snapshot.head.memoryRevision >= previous.head.memoryRevision;
    if (token === generation && !disposed && newer) {
      const readOnly = snapshot.head.sessionId !== head.sessionId;
      active = { ...snapshot.head, sessionId: head.sessionId };
      const lastSaved = slots.find(slot => slot.kind === 'manual' && slot.slotId === pointer?.manualSlotId) ?? null;
      publish({ snapshot, ...projected, slots, lastSaved, readOnly, ...(readOnly ? { error: '这个存档已在另一个页面接管，当前页面只读；请重新进入后再继续。' } : {}) });
    }
    return snapshot;
  };
  const controller: CoreGameController = {
    async refreshExternal() {
      const owner = requireActive(), token = generation, snapshot = await repo.readState(owner.scope);
      if (disposed || token !== generation || !view.snapshot) return;
      if (snapshot.head.sessionId !== owner.sessionId) { publish({ readOnly: true, error: '这个存档已由其它页面接管，当前页面只读。' }); return; }
      const previous = view.snapshot.head;
      if (snapshot.head.coreSeq > previous.coreSeq || snapshot.head.coreSeq === previous.coreSeq && snapshot.head.memoryRevision >= previous.memoryRevision) {
        active = { ...snapshot.head, sessionId: owner.sessionId }; publish({ snapshot, jobRevision: view.jobRevision + 1 });
      }
      // Keep main chat bodies and pending main-turn controls untouched.
    },
    async refreshDerived() {
      const owner = requireActive(), token = generation, capturedReceipt = view.receipt, actual = await repo.readHead(owner.scope);
      const jobs = capturedReceipt?.jobIds?.length ? await readCoreJobAttemptView(repo, owner.scope, actual.coreSeq, capturedReceipt.jobIds) : [];
      if (disposed || token !== generation || !view.snapshot) return;
      if (actual.sessionId !== owner.sessionId) { publish({ readOnly: true, error: '这个存档已由其它页面接管，当前页面只读。', jobRevision: view.jobRevision + 1 }); return; }
      const receipt = view.receipt === capturedReceipt && capturedReceipt?.jobIds ? { ...capturedReceipt, memoryPending: coreJobAttemptsPending(owner.scope, capturedReceipt.operationId, capturedReceipt.jobIds, jobs) } : view.receipt;
      publish({ jobRevision: view.jobRevision + 1, receipt, ...(actual.coreSeq === view.snapshot.head.coreSeq ? { snapshot: { ...view.snapshot, head: { ...view.snapshot.head, memoryRevision: Math.max(view.snapshot.head.memoryRevision, actual.memoryRevision) } } } : {}) });
    },
    getView: () => view,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async initialize(seed) {
      const token = ++generation; for (const abort of aborts.values()) abort.abort(); aborts.clear();
      const head = await initializeCoreJourney(repo, seed);
      if (token !== generation || disposed) return head;
      active = head; pointer = { scope: head.scope };
      publish({ snapshot: null, messages: [], result: null, error: null, autoSaveError: null, pendingOperationId: null, lastSaved: null, busy: false, readOnly: false, receipt: null, pendingReviews: [] });
      await navigation(); await read(); return head;
    },
    async attach(next) {
      const token = ++generation; for (const abort of aborts.values()) abort.abort(); aborts.clear();
      const head = await repo.activateSession(next.scope, crypto.randomUUID());
      const pending = next.pendingOperationId ? await repo.readOperation(next.scope, next.pendingOperationId) : null;
      if (token !== generation || disposed) return head;
      active = head; pointer = structuredClone(next);
      const missingInput = !!next.pendingOperationId && !pending;
      if (!pending || pending.status === 'committed' || pending.status === 'cancelled') delete pointer.pendingOperationId;
      publish({ pendingOperationId: pointer.pendingOperationId ?? null, busy: false, result: null, error: missingInput ? '上次输入未能建立可恢复记录，请检查输入后重新发送。' : null, autoSaveError: null, readOnly: false }); await navigation(); await read(); return active;
    },
    async send(input) {
      const head = requireActive();
      if (view.readOnly || !sameScope(head.scope, input.scope) || head.sessionId !== input.sessionId) throw Error('CORE2_SESSION_CHANGED');
      if (view.busy) throw Error('CORE2_TURN_BUSY');
      if (view.pendingOperationId && view.pendingOperationId !== input.operationId) throw Error('CORE2_PENDING_TURN_REQUIRES_REVIEW');
      const token = generation, abort = new AbortController(); aborts.set(input.operationId, abort);
      const upstreamAbort = () => abort.abort(input.signal?.reason); input.signal?.addEventListener('abort', upstreamAbort, { once: true }); if (input.signal?.aborted) upstreamAbort();
      pointer = { ...pointer!, scope: head.scope, pendingOperationId: input.operationId };
      publish({ busy: true, error: null, pendingOperationId: input.operationId }); await navigation();
      try {
        const result = await runCoreTurn({ ...input, signal: abort.signal }, { ...options.turnDependencies(), repo, getActiveSession: () => active && !disposed ? { scope: active.scope, sessionId: active.sessionId } : null,
          onSource: source => { if (generation === token) { const next = entry(source, 'pending'); publish({ messages: [...view.messages.filter(row => row.id !== next.id), next] }); } },
        });
        if (token === generation) {
          // An initial source/preparation write may fail before there is any
          // durable operation to retry. Do not lock the page behind a phantom ID.
          const initialWriteFailed = result.kind === 'failed' && !await repo.readOperation(head.scope, input.operationId);
          const finished = result.kind === 'committed' || result.kind === 'pending' || result.kind === 'cancelled' || initialWriteFailed;
          if (finished && pointer) delete pointer.pendingOperationId;
          publish({ result, pendingOperationId: finished ? null : input.operationId, error: result.kind === 'failed' ? result.detail : null }); await navigation(); await read();
          if ((result.kind === 'committed' || result.kind === 'pending') && options.autoSave && token === generation) {
            try { await controller.saveAutomatic(); } catch { /* The separate save error must not turn a committed turn into a failed one. */ }
          }
        }
        return result;
      } finally { input.signal?.removeEventListener('abort', upstreamAbort); aborts.delete(input.operationId); if (generation === token) publish({ busy: false }); }
    },
    async retry(operationId) {
      const head = requireActive(), operation = await repo.readOperation(head.scope, operationId);
      if (!operation) throw Error('CORE2_OPERATION_NOT_FOUND');
      const sources = await Promise.all(operation.sourceRefs.map(ref => repo.readSource(ref)));
      const source = sources.find(row => row?.kind === 'player_input'); if (!source) throw Error('CORE2_INPUT_SOURCE_MISSING');
      return controller.send({ scope: head.scope, sessionId: head.sessionId, operationId, text: source.blocks.filter(block => block.kind === 'message').map(block => block.text).join('\n') });
    },
    async cancel(operationId) {
      const head = requireActive(); aborts.get(operationId)?.abort();
      try { await repo.cancelOperation(head.scope, operationId); publish({ error: null }); }
      catch (error) { publish({ error: `停止状态未能保存：${errorText(error)}` }); throw error; }
    },
    async save(input) {
      const head = requireActive(), token = generation; if (!sameScope(head.scope, input.scope) || view.busy || view.readOnly) throw Error('CORE2_SAVE_NOT_READY');
      try {
        const slot = await saveSlot(repo, { ...input, ...(!input.asNew && input.kind === 'manual' && pointer?.manualSlotId ? { currentSlotId: pointer.manualSlotId } : {}) });
        if (token === generation && !disposed) {
          if (input.kind === 'manual' && pointer) pointer.manualSlotId = slot.slotId;
          publish({ lastSaved: slot, error: null }); await navigation(); await read();
        }
        return slot;
      } catch (error) { if (token === generation) publish({ error: `保存失败：${errorText(error)}` }); throw error; }
    },
    async saveAutomatic() {
      const head = requireActive(), token = generation;
      if (view.readOnly) throw Error('CORE2_SAVE_NOT_READY');
      try {
        const slot = await saveAutomaticCoreTurn(repo, head.scope, head.sessionId);
        const slots = await repo.listSaveSlots(head.scope.journeyId);
        if (token === generation && !disposed) publish({ slots, autoSaveError: null });
        return slot;
      } catch (error) {
        if (token === generation && !disposed) publish({ autoSaveError: `剧情已保存，但自动存档节点未更新：${errorText(error)}` });
        throw error;
      }
    },
    async restore(snapshotId) {
      const head = requireActive(), token = ++generation;
      for (const abort of aborts.values()) abort.abort(); aborts.clear();
      const snapshot = await repo.readSnapshot(snapshotId);
      if (token !== generation || disposed) throw Error('CORE2_SESSION_CHANGED');
      if (!snapshot || snapshot.scope.journeyId !== head.scope.journeyId) throw Error('CORE2_RESTORE_SCOPE');
      const next = await repo.fork({ snapshotId, parentScope: snapshot.scope, branchId: crypto.randomUUID(), sessionId: crypto.randomUUID() });
      if (token !== generation || disposed) return next;
      active = next; const manual = view.slots.find(slot => slot.kind === 'manual' && slot.snapshotId === snapshotId);
      pointer = { scope: next.scope, ...(manual ? { manualSlotId: manual.slotId } : {}) }; publish({ busy: false, error: null, autoSaveError: null, pendingOperationId: null, result: null, readOnly: false }); await navigation(); await read(); return next;
    },
    read,
    async review(originOperationId, candidate, decision) {
      const head = requireActive(), token = generation;
      if (view.busy || view.readOnly) throw Error('CORE2_REVIEW_NOT_READY');
      publish({ busy: true, error: null });
      try {
        const receipt = await reviewPendingCandidate(repo, { scope: head.scope, sessionId: head.sessionId, operationId: crypto.randomUUID(), originOperationId, candidateId: candidate.candidateId, sourceVersion: candidate.evidenceRefs[0]?.ref.sourceVersion ?? 0, decision }, { ...options.turnDependencies(), getActiveSession: () => active });
        if (token === generation) await read(); return receipt;
      } catch (error) { if (token === generation) publish({ error: errorText(error) }); throw error; }
      finally { if (token === generation) publish({ busy: false }); }
    },
    async execute(action) {
      const head = requireActive(), token = generation; if (view.busy || view.readOnly || action.kind !== 'player' || !sameScope(action.source.scope, head.scope)) throw Error('CORE2_PLAYER_ACTION_AUTHORITY');
      publish({ busy: true, error: null });
      try {
        const receipt = await settleCoreOperation({ scope: head.scope, sessionId: head.sessionId, operationId: action.source.operationId, kind: 'manual', sources: [action.source], playerActions: [action] }, { ...options.turnDependencies(), repo, getActiveSession: () => active });
        if (token === generation && (receipt.status === 'committed' || receipt.status === 'already_committed')) await read();
        return receipt;
      } catch (error) { if (token === generation) publish({ error: errorText(error) }); throw error; }
      finally { if (token === generation) publish({ busy: false }); }
    },
    dispose() { disposed = true; generation++; for (const [id, abort] of aborts) { abort.abort(); if (active) void repo.cancelOperation(active.scope, id).catch(() => undefined); } aborts.clear(); listeners.clear(); },
  };
  return controller;
}
