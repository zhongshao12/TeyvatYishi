import type { GameEvent } from '../contracts/event';
import type { MemoryRecord } from '../contracts/memory';
import type { MemoryReadRef, SourceRef } from '../contracts/identity';
import type { Page } from '../contracts/storage';
import { requireCurrentCoreIndex, indexTerms } from '../persistence/indexMaintenance';
import { ownDto, compareCoreIds } from '../persistence/repositoryValidation';
import { selectDueCommitments } from '../knowledge/commitments';
import { rankCandidates, CORE_RECALL_RANKING_VERSION } from './rankCandidates';
import type { CoreRecallRequest, CoreRecallResult, RecallDependencies, RecallItem } from './recallTypes';
export type { CoreRecallRequest, CoreRecallResult, RecallDependencies, RecallItem } from './recallTypes';

function stop(signal?: AbortSignal): void { if (signal?.aborted) throw Error('CORE2_RECALL_CANCELLED'); }
async function collect<T>(read: (cursor?: string) => Promise<Page<T>>, signal?: AbortSignal): Promise<T[]> {
  const items: T[] = [], cursors = new Set<string>(); let cursor: string | undefined;
  do {
    stop(signal); const page = await read(cursor); stop(signal); items.push(...page.items); cursor = page.nextCursor;
    if (cursor && cursors.has(cursor)) throw Error('CORE2_RECALL_CURSOR_LOOP'); if (cursor) cursors.add(cursor);
  } while (cursor);
  return items;
}
const uniqueRefs = (refs: SourceRef[]) => [...new Map(refs.map(ref => [JSON.stringify(ref), ref])).values()];

/** Indexes suggest candidates; branch-bounded ledger and explicit knowledge grant permission. */
export async function retrieveCoreMemories(input: CoreRecallRequest, deps: RecallDependencies): Promise<CoreRecallResult> {
  const { signal } = input;
  const request = structuredClone({ ...input, signal: undefined });
  request.scope = ownDto('scope', request.scope); request.head = ownDto('head', request.head);
  const { repo } = deps, { scope, head, audience } = request;
  if (head.scope.journeyId !== scope.journeyId || head.scope.branchId !== scope.branchId
    || !Array.isArray(audience.npcIds) || !['main', 'private', 'group', 'moment', 'news', 'image'].includes(audience.target)) throw Error('CORE2_RECALL_REQUEST_INVALID');
  const k = request.k ?? 8; if (!Number.isSafeInteger(k) || k < 0 || k > 8) throw Error('CORE2_RECALL_K_INVALID');
  const checkPosition = async () => {
    stop(signal); const now = await repo.readHead(scope); stop(signal);
    if (now.sessionId !== head.sessionId || now.coreSeq !== head.coreSeq || now.memoryRevision !== head.memoryRevision) throw Error('CORE2_RECALL_POSITION_CHANGED');
  };
  await checkPosition();
  const indexPosition = await requireCurrentCoreIndex(repo, { scope, sessionId: head.sessionId, signal });
  if (indexPosition.coreSeq !== head.coreSeq || indexPosition.memoryRevision !== head.memoryRevision) throw Error('CORE2_RECALL_POSITION_CHANGED');
  const base = { scope, cutoffSeq: head.coreSeq }, memoryBase = { ...base, memoryRevision: head.memoryRevision };
  const diagnostics: CoreRecallResult['diagnostics'] = [], eventIds = new Set<string>(), memoryIds = new Set<string>();
  for (const [kind, keys] of [['npc', request.entityIds], ['location', request.locations], ['keyword', indexTerms(request.query)]] as const) {
    if (!keys.length) continue;
    const rows = await collect(cursor => repo.queryPostings({ ...memoryBase, kind, keys: [...new Set(keys)], limit: 50, ...(cursor ? { cursor } : {}) }), signal);
    rows.forEach(row => (row.target === 'event' ? eventIds : memoryIds).add(row.targetId));
  }
  // The live, short window is independent of a long/world-tree hit.
  const recent = await collect(cursor => repo.queryEvents({ ...base, turns: Array.from({ length: Math.min(5, Math.max(0, request.moment.turn)) }, (_, i) => request.moment.turn - i), limit: 50, ...(cursor ? { cursor } : {}) }), signal);
  recent.forEach(event => eventIds.add(event.eventId));
  const protectedRows = await collect(cursor => repo.queryPostings({ ...memoryBase, kind: 'type', keys: ['protected'], target: 'memory', limit: 50, ...(cursor ? { cursor } : {}) }), signal);
  protectedRows.forEach(row => memoryIds.add(row.targetId));
  const memories:MemoryRecord[]=[], selectedMemoryIds=[...memoryIds];
  for(let offset=0;offset<selectedMemoryIds.length;offset+=50) memories.push(...await collect(cursor => repo.queryMemories({ ...memoryBase, memoryIds:selectedMemoryIds.slice(offset,offset+50), statuses: ['active'], limit: 50, ...(cursor ? { cursor } : {}) }), signal));
  const allActive = memories;
  const versionCache = new Map<string, MemoryRecord>(allActive.map(memory => [JSON.stringify([memory.memoryId, memory.version]), memory]));
  const graphs = new Map<string, { leaves: string[]; complete: boolean }>();
  async function resolve(memory: MemoryRecord, path: Set<string>): Promise<{ leaves: string[]; complete: boolean }> {
    const key = JSON.stringify([memory.memoryId, memory.version]);
    if (path.has(key) || path.size >= 64) return { leaves: [], complete: false };
    const cached = graphs.get(key); if (cached) return cached;
    const next = new Set(path).add(key), leaves = new Set(memory.eventIds); let complete = true;
    const missing: MemoryReadRef[] = memory.memoryRefs.filter(ref => !versionCache.has(JSON.stringify([ref.memoryId, ref.version])));
    for (let offset = 0; offset < missing.length; offset += 100) {
      stop(signal); const rows = await repo.readMemoryVersions({ ...memoryBase, refs: missing.slice(offset, offset + 100) });
      rows.forEach(row => versionCache.set(JSON.stringify([row.memoryId, row.version]), row));
    }
    for (const ref of memory.memoryRefs) {
      const child = versionCache.get(JSON.stringify([ref.memoryId, ref.version]));
      if (!child) { complete = false; continue; }
      const graph = await resolve(child, next); graph.leaves.forEach(id => leaves.add(id)); complete &&= graph.complete;
    }
    const result = { leaves: [...leaves], complete }; graphs.set(key, result); return result;
  }
  for (const memory of memories) (await resolve(memory, new Set())).leaves.forEach(id => eventIds.add(id));
  const commitments = selectDueCommitments(await collect(cursor => repo.queryCommitments({ ...base, statuses: ['pending', 'due'], limit: 50, ...(cursor ? { cursor } : {}) }), signal), request.moment);
  commitments.forEach(row => eventIds.add(row.establishedEventId));
  const events = new Map<string, GameEvent>(), ids = [...eventIds].sort(compareCoreIds);
  // At most one page per exact-ID batch: the existing cursor also owns the
  // query descriptor, which can exceed its 1000-character contract for 100 IDs.
  for (let i = 0; i < ids.length; i += 50) {
    const rows = await collect(cursor => repo.queryEvents({ ...base, eventIds: ids.slice(i, i + 50), limit: 50, ...(cursor ? { cursor } : {}) }), signal);
    rows.forEach(row => events.set(row.eventId, row));
  }
  const knowledge = audience.npcIds.length ? await collect(cursor => repo.queryKnowledge({ ...base, npcIds: audience.npcIds, limit: 50, ...(cursor ? { cursor } : {}) }), signal) : [];
  const permitted = (event: GameEvent) => {
    if (event.type === 'narration.recorded') return audience.target === 'main' && !audience.npcIds.length;
    if (audience.target === 'news') return event.visibility.kind === 'public';
    if (!audience.npcIds.length) return true; // Author/player reference, never NPC knowledge.
    return audience.npcIds.every(npcId => knowledge.some(row => row.npcId === npcId && row.eventId === event.eventId && row.nature === 'fact' && !['rumor', 'inferred'].includes(row.mode)));
  };
  const visible = new Map([...events].filter(([id, event]) => {
    if (event.type === 'turn.complete') { diagnostics.push({ id, reason: 'technical_completion_anchor_not_fact' }); return false; }
    if (permitted(event)) return true; diagnostics.push({ id, reason: 'not_known_to_every_recipient' }); return false;
  }));
  const terms = new Set(indexTerms(request.query));
  const rank = (text: string, npcIds: string[], locations: string[], importance: number, recent: number) => ({
    entities: request.entityIds.filter(id => npcIds.includes(id)).length,
    locations: request.locations.filter(location => locations.includes(location)).length,
    terms: indexTerms(text).filter(term => terms.has(term)).length, importance, recent, unfinished: 0,
  });
  const candidateForEvent = (event: GameEvent): RecallItem => {
    const text = event.evidenceRefs.map(ref => ref.quote).join('\n');
    return { kind: event.type === 'narration.recorded' ? 'narration' : event.type.startsWith('communication.') ? 'utterance' : 'event', ...(event.type.startsWith('communication.') ? { speakerId: event.actorIds[0] } : {}),
      ...(event.type === 'narration.recorded' ? { meaning: '叙事记录，仅供作者参考；不是已审核的状态变化，不授予NPC知识。' } : {}), eventId: event.eventId, leafIds: [event.eventId], sourceRefs: uniqueRefs(event.evidenceRefs.map(ref => ref.ref)), text,
      protected: false, reason: 'confirmed_visible_event', rank: rank(text, [...event.actorIds, ...event.targetIds], event.occurredMoment.location ? [event.occurredMoment.location] : [], 0, event.turn) };
  };
  const candidates = [...visible.values()].map(candidateForEvent), mandatory: RecallItem[] = [];
  for (const memory of memories) {
    const graph = await resolve(memory, new Set()), allowed = graph.leaves.filter(id => visible.has(id));
    const visibility = audience.target === 'news' ? memory.visibility.kind === 'public' : !audience.npcIds.length || memory.visibility.kind === 'public' || audience.npcIds.every(id => memory.visibility.npcIds.includes(id));
    if (!graph.complete || !visibility || !allowed.length || allowed.length !== graph.leaves.length) {
      diagnostics.push({ id: memory.memoryId, reason: graph.complete ? 'mixed_summary_degraded' : 'unresolvable_summary_degraded' }); continue;
    }
    const item: RecallItem = { kind: 'summary', eventId: allowed[0]!, leafIds: allowed, sourceRefs: uniqueRefs(memory.sourceRefs), text: memory.text, memoryId: memory.memoryId,
      ...(allowed.some(id => visible.get(id)?.type === 'narration.recorded') ? { meaning: '此摘要含叙事记录，仅供作者参考；不是已审核的状态变化，不授予NPC知识。' } : {}),
      protected: memory.pinned, reason: memory.pinned ? 'player_pinned' : 'all_summary_leaves_authorized', rank: rank(memory.text, memory.npcIds, memory.locations, memory.importance, Math.max(0, ...memory.turns)) };
    (memory.pinned ? mandatory : candidates).push(item);
  }
  for (const commitment of commitments) {
    const event = visible.get(commitment.establishedEventId);
    if (!event || (audience.npcIds.length && !audience.npcIds.every(id => commitment.participantIds.includes(id)))) continue;
    mandatory.push({ ...candidateForEvent(event), kind: 'commitment', commitmentId: commitment.commitmentId, text: commitment.text, protected: true, reason: 'due_not_fulfilled' });
  }
  const selected = new Set(mandatory.flatMap(row => row.leafIds)), optional: RecallItem[] = [];
  for (const item of rankCandidates(candidates)) {
    if (optional.length >= k) break;
    if (item.leafIds.some(id => selected.has(id))) { diagnostics.push({ id: item.memoryId ?? item.eventId, reason: 'event_identity_duplicate' }); continue; }
    optional.push(item); item.leafIds.forEach(id => selected.add(id));
  }
  await checkPosition();
  return { bundleId: `memory-bundle-${crypto.randomUUID()}`, scope, coreSeq: head.coreSeq, memoryRevision: head.memoryRevision, audience,
    mandatory, optional, selectedLeafIds: [...selected], indexPosition, completeness: 'complete', rankingVersion: CORE_RECALL_RANKING_VERSION, diagnostics };
}
