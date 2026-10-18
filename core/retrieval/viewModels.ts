import type { BranchHead, SourceRef } from '../contracts/identity';
import type { MemoryRecord, JobRecord } from '../contracts/memory';
import type { OperationRecord } from '../contracts/operation';
import type { GameEvent, SourceRecord } from '../contracts/event';
import type { CoreSnapshot, StateRecord } from '../contracts/state';
import type { CoreRepository, SaveSlot, Page } from '../contracts/storage';
import type { CoreRecallRequest, RecallItem } from './recallTypes';
import { retrieveCoreMemories } from './retrieveMemory';
import { ownDto, compareCoreIds } from '../persistence/repositoryValidation';
import { paged } from '../persistence/pagination';
import { sanitizeApiErrorReportText } from '@/services/ai/apiErrorReportService';

export interface CoreFailureItem { id: string; category: 'job' | 'operation'; title: string; detail: string; status: string; gameplaySaved: boolean; canRetry: boolean; canStop: boolean; sourceRefs: SourceRef[] }
interface Conditions {
  memory: { layers?: MemoryRecord['layer'][] }; irminsul: { layers?: MemoryRecord['layer'][] };
  companion: { search?: string; snapshot?: CoreSnapshot; archived?: boolean }; courier: { conversationId: string };
  save: Record<never, never>; failure: { category: 'job' | 'operation' }; source: { ref: SourceRef }; recall: { request: CoreRecallRequest };
}
export interface CoreViewItems { memory: MemoryRecord; irminsul: MemoryRecord; companion: StateRecord<'npc'>; courier: GameEvent; save: SaveSlot; failure: CoreFailureItem; source: SourceRecord; recall: RecallItem }
export type CoreViewKind = keyof CoreViewItems;
export type CoreViewRequest<K extends CoreViewKind = CoreViewKind> = { [P in K]: { kind: P; head: BranchHead; cursor?: string; signal?: AbortSignal } & Conditions[P] }[K];
export interface CoreViewPage<K extends CoreViewKind = CoreViewKind> extends Page<CoreViewItems[K]> { kind: K }
export interface CoreViewDependencies { repo: CoreRepository }

export function projectCoreFailure(row: JobRecord | OperationRecord): CoreFailureItem {
  if ('jobId' in row) {
    const published = row.publicationReceipt?.status === 'published';
    return { id: row.jobId, category: 'job', title: published ? '结果已保存，完成标记待恢复' : row.status === 'failed' ? '后台任务失败 · 剧情已保存' : '后台任务尚未完成 · 剧情已保存',
      detail: sanitizeApiErrorReportText(row.failure?.detail ?? ''), status: row.status, gameplaySaved: true, canRetry: ['failed', 'pending', 'running'].includes(row.status) || row.status === 'cancelled' && ['courier', 'turn_summary', 'compression', 'rebuild', 'manual_memory', 'news', 'image', 'profile'].includes(row.kind), canStop: !published && ['pending', 'running'].includes(row.status), sourceRefs: row.sourceRefs };
  }
  return { id: row.operationId, category: 'operation', title: row.status === 'cancelled' ? '本回合已停止' : '主流程尚未完成结算',
    detail: sanitizeApiErrorReportText(row.failure?.detail ?? ''), status: row.status, gameplaySaved: row.status === 'committed', canRetry: ['failed', 'draft', 'prepared'].includes(row.status), canStop: ['draft', 'prepared'].includes(row.status), sourceRefs: row.sourceRefs };
}
/** Reads only the selected view. Raw sources and binaries are not panel prerequisites. */
export async function buildCoreView<K extends CoreViewKind>(input: CoreViewRequest<K>, { repo }: CoreViewDependencies): Promise<CoreViewPage<K>> {
  const signal = input.signal, { signal: _signal, ...data } = input, request = structuredClone(data) as CoreViewRequest;
  const head = ownDto('head', request.head), base = { scope: head.scope, cutoffSeq: head.coreSeq, limit: 50, ...(request.cursor ? { cursor: request.cursor } : {}) };
  const guard = async () => { if (signal?.aborted) throw Error('CORE2_VIEW_CANCELLED'); if ((await repo.readHead(head.scope)).sessionId !== head.sessionId) throw Error('CORE2_VIEW_SESSION_CHANGED'); if (signal?.aborted) throw Error('CORE2_VIEW_CANCELLED'); };
  await guard(); let page: Page<CoreViewItems[CoreViewKind]>;
  switch (request.kind) {
    case 'memory': case 'irminsul':
      page = await repo.queryMemories({ ...base, memoryRevision: head.memoryRevision, statuses: ['active'], ...(request.layers ? { layers: request.layers } : request.kind === 'irminsul' ? { layers: ['long'] } : {}) }); break;
    case 'courier': page = await repo.queryEvents({ ...base, channelIds: [request.conversationId], types: ['communication.private', 'communication.group', 'communication.moment'], direction: 'desc' }); break;
    case 'source': {
      page = await repo.querySources({ ...base, refs: [request.ref] }); if (!page.items.length) throw Error('CORE2_VIEW_SOURCE_MISSING'); break;
    }
    case 'companion': {
      const snapshot = request.snapshot ?? await repo.readState(head.scope);
      if (snapshot.head.coreSeq !== head.coreSeq || snapshot.head.scope.journeyId !== head.scope.journeyId || snapshot.head.scope.branchId !== head.scope.branchId) throw Error('CORE2_VIEW_POSITION_CHANGED');
      const items = snapshot.records.filter((row): row is StateRecord<'npc'> => row.domain === 'npc' && (request.archived === undefined || !!row.value.archived === request.archived)
        && (!request.search || [row.value.姓名, ...row.value.aliases].some(name => name.includes(request.search!)))).sort((a, b) => compareCoreIds(a.entityId, b.entityId));
      page = paged(items, { ...base, ...{ search: request.search ?? '', archived: request.archived ?? 'all' } }, row => row.entityId); break;
    }
    case 'save': {
      const slots = await repo.listSaveSlots(head.scope.journeyId); slots.sort((a, b) => b.updatedAt - a.updatedAt || compareCoreIds(a.slotId, b.slotId));
      page = paged(slots, base, row => row.slotId); break;
    }
    case 'failure': {
      const rows = request.category === 'job' ? await repo.queryJobs({ ...base, statuses: ['failed', 'pending', 'running', 'cancelled'], activeAttemptsOnly: true })
        : await repo.queryOperations({ ...base, statuses: ['failed', 'draft', 'prepared', 'cancelled'] });
      page = { ...rows, items: rows.items.map(projectCoreFailure) }; break;
    }
    case 'recall': {
      if (JSON.stringify(request.request.head) !== JSON.stringify(head)) throw Error('CORE2_VIEW_RECALL_POSITION');
      const result = await retrieveCoreMemories({ ...request.request, signal }, { repo });
      page = { items: [...result.mandatory, ...result.optional] }; break;
    }
  }
  await guard(); return { ...page, kind: request.kind } as CoreViewPage<K>;
}
