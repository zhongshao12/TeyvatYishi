import type { ImportedMemory, PreparedImport, SnapshotRecord } from '../contracts/storage';
import type { CoreScope, SourceRef, RecordRef } from '../contracts/identity';
import type { StateRecord, CoreSnapshot } from '../contracts/state';
import type { EvidenceRef } from '../contracts/event';
import type { CoreDtoKind, CoreDtoTypes } from '../contracts/validation';
import { isCoreJsonData } from '../contracts/validation';
import { dataFields, ownAsset } from './binaryAssets';
import { assertId, ownDto, refKey, sameData, sameScope, sourceRefKey, stableJson, unique } from './repositoryValidation';
import { checksumUtf8 } from '../sources/sourceIntegrity';
import { validateEvidence } from '../sources/sourceRecords';
import { stateAssetIds } from './stateAssets';
import { isRegisteredStagedJobSource } from './stagedJobSources';

const fields = ['manifest', 'branches', 'sources', 'events', 'operations', 'memories', 'knowledge', 'commitments', 'jobs', 'snapshots', 'slots', 'assets'];
function list<K extends CoreDtoKind>(kind: K, value: unknown): CoreDtoTypes[K][] {
  if (!Array.isArray(value)) throw new Error('CORE2_INVALID_IMPORT');
  return value.map(row => ownDto(kind, row));
}

export function ownPreparedImport(input: PreparedImport): PreparedImport {
  const record = dataFields(input, fields, 'CORE2_INVALID_IMPORT');
  const { assets, ...metadata } = record;
  if (!isCoreJsonData(metadata) || !Array.isArray(assets)) throw new Error('CORE2_INVALID_IMPORT');
  const data = structuredClone(metadata) as Omit<PreparedImport, 'assets'>;
  try {
    ownDto('manifest', data.manifest);
    if (![data.branches, data.sources, data.memories, data.knowledge, data.commitments, data.jobs].every(Array.isArray)) throw new Error();
    for (const row of data.branches) { dataFields(row, row.originSnapshotId === undefined ? ['playerId', 'state'] : ['playerId', 'state', 'originSnapshotId'], 'CORE2_INVALID_IMPORT'); ownDto('snapshot', row.state); assertId(row.playerId); if (row.originSnapshotId) assertId(row.originSnapshotId); }
    for (const [rows, kind] of [[data.sources, 'source'], [data.memories, 'memory'], [data.knowledge, 'knowledge'], [data.commitments, 'commitment'], [data.jobs, 'job']] as const) {
      for (const row of rows) {
        const keys = kind === 'memory' ? ['record', 'commitSeq', 'publishedRevision'] : kind === 'job'
          ? ['record', 'commitSeq', 'leaseIds', ...('publication' in row ? ['publication'] : [])] : ['record', 'commitSeq'];
        dataFields(row, keys, 'CORE2_INVALID_IMPORT'); ownDto(kind, row.record);
        if (row.commitSeq === null ? kind !== 'source' : !Number.isSafeInteger(row.commitSeq) || row.commitSeq < 0) throw new Error();
      }
    }
    list('event', data.events); list('operation', data.operations); list('snapshotRecord', data.snapshots); list('saveSlot', data.slots);
    return { ...data, assets: assets.map(row => ownAsset(row)) };
  } catch { throw new Error('CORE2_INVALID_IMPORT'); }
}

const scopeId = (scope: CoreScope): string => `${scope.journeyId}/${scope.branchId}`;
const scopedId = (scope: CoreScope, id: string): string => `${scopeId(scope)}/${id}`;
const sorted = <T>(items: T[], key: (value: T) => string): T[] => [...items].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
function projection(state: CoreSnapshot) {
  return { records: sorted(state.records, refKey), tombstones: sorted(state.tombstones ?? [], refKey), contentRefs: state.contentRefs };
}

/** In-memory referential validation BEFORE any store is opened or a write starts. */
export function validateImportGraph(value: PreparedImport): void {
  const branches = new Map(value.branches.map(row => [scopeId(row.state.head.scope), row]));
  const snapshots = new Map(value.snapshots.map(row => [row.snapshotId, row]));
  const events = new Map(value.events.map(row => [row.eventId, row]));
  const sources = new Map(value.sources.map(row => [sourceRefKey(row.record.ref), row]));
  const operations = new Map(value.operations.map(row => [scopedId(row.scope, row.operationId), row]));
  const selected = branches.get(scopeId(value.manifest.scope));
  if (!selected || branches.size !== value.branches.length || !value.branches.length) throw new Error('CORE2_IMPORT_LINEAGE');
  const journeyId = value.manifest.scope.journeyId;
  const path = (scope: CoreScope, seq?: number, revision?: number) => {
    const result: { scope: CoreScope; seq: number; revision: number }[] = [], seen = new Set<string>();
    let row = branches.get(scopeId(scope));
    if (!row) throw new Error('CORE2_IMPORT_LINEAGE');
    let cut = seq ?? row.state.head.coreSeq, rev = revision ?? row.state.head.memoryRevision;
    while (row) {
      const head = row.state.head;
      if (head.scope.journeyId !== journeyId || seen.has(scopeId(head.scope)) || cut > head.coreSeq || rev > head.memoryRevision) throw new Error('CORE2_IMPORT_LINEAGE');
      seen.add(scopeId(head.scope)); result.push({ scope: head.scope, seq: cut, revision: rev });
      if (!head.parent) return result;
      cut = Math.min(cut, head.forkSeq!); rev = Math.min(rev, head.forkMemoryRevision!);
      row = branches.get(scopeId(head.parent)); if (!row) throw new Error('CORE2_IMPORT_LINEAGE');
    }
    throw new Error('CORE2_IMPORT_LINEAGE');
  };
  // A branch export is an ancestor closure, not an opportunity to smuggle siblings.
  const closure = path(value.manifest.scope);
  if (closure.length !== branches.size) throw new Error('CORE2_IMPORT_LINEAGE');
  for (const bound of closure) {
    const head = branches.get(scopeId(bound.scope))!.state.head;
    if (head.coreSeq !== bound.seq || head.memoryRevision !== bound.revision) throw new Error('CORE2_IMPORT_LINEAGE_FUTURE');
  }
  const positioned = (scope: CoreScope, seq: number, revision?: number) => {
    const head = branches.get(scopeId(scope))?.state.head;
    if (!head || !Number.isSafeInteger(seq) || seq < 0 || seq > head.coreSeq || (revision !== undefined &&
      (!Number.isSafeInteger(revision) || revision < 1 || revision > head.memoryRevision))) throw new Error('CORE2_IMPORT_POSITION');
  };
  const reachable = (from: CoreScope, seq: number, target: CoreScope, targetSeq: number, revision?: number, targetRevision?: number) =>
    path(from, seq, revision).some(bound => sameScope(bound.scope, target) && targetSeq <= bound.seq && (targetRevision === undefined || targetRevision <= bound.revision));
  const sourceReachable = (refs: SourceRef[], scope: CoreScope, seq: number, operationId?: string) => {
    for (const ref of refs) {
      const source = sources.get(sourceRefKey(ref));
      if (!source || (source.commitSeq === null ? !operationId || !sameScope(source.record.scope, scope) || source.record.operationId !== operationId :
        !reachable(scope, seq, source.record.scope, source.commitSeq))) throw new Error('CORE2_IMPORT_SOURCE_NOT_REACHABLE');
    }
  };
  const evidenceReachable = (refs: EvidenceRef[], scope: CoreScope, seq: number, operationId?: string) => {
    sourceReachable(refs.map(row => row.ref), scope, seq, operationId);
    for (const evidence of refs) if (!validateEvidence(evidence, sources.get(sourceRefKey(evidence.ref))!.record).ok) throw new Error('CORE2_IMPORT_INVALID_EVIDENCE');
  };
  const eventReachable = (id: string, scope: CoreScope, seq: number) => {
    const event = events.get(id);
    return !!event && reachable(scope, seq, { journeyId: event.journeyId, branchId: event.branchId }, event.commitSeq);
  };
  const identities = [unique(value.snapshots, row => row.snapshotId), unique(value.sources, row => sourceRefKey(row.record.ref)),
    unique(value.events, row => row.eventId), unique(value.operations, row => scopedId(row.scope, row.operationId)),
    unique(value.memories, row => `${scopedId(row.record.scope, row.record.memoryId)}/${row.record.version}`),
    unique(value.knowledge, row => `${scopedId(row.record.scope, row.record.knowledgeId)}/${row.record.version}`),
    unique(value.commitments, row => `${scopedId(row.record.scope, row.record.commitmentId)}/${row.record.version}`),
    unique(value.jobs, row => scopedId(row.record.scope, row.record.jobId)), unique(value.assets, row => row.assetId), unique(value.slots, row => row.slotId)];
  if (identities.includes(false)) throw new Error('CORE2_IMPORT_DUPLICATE_ID');

  for (const row of value.sources) {
    const head = branches.get(scopeId(row.record.scope))?.state.head;
    if (!head) throw new Error('CORE2_IMPORT_LINEAGE');
    if (!unique(row.record.blocks, block => block.blockId)) throw new Error('CORE2_IMPORT_INVALID_SOURCE');
    if (row.record.publicCitations) {
      const cut = row.commitSeq === null ? head.coreSeq : Math.max(0, row.commitSeq - 1);
      if (row.record.kind !== 'news' || !unique(row.record.publicCitations, citation => citation.blockId)) throw Error('CORE2_IMPORT_NEWS_CITATION');
      for (const citation of row.record.publicCitations) {
        if (!row.record.blocks.some(block => block.blockId === citation.blockId)) throw Error('CORE2_IMPORT_NEWS_CITATION');
        for (const id of citation.eventIds) {
          const event = events.get(id);
          if (!event || !eventReachable(id, row.record.scope, cut) || event.visibility.kind !== 'public' || /^(?:communication\.|player\.|publication\.)/u.test(event.type) || event.type === 'turn.complete') throw Error('CORE2_IMPORT_NEWS_CITATION');
        }
      }
    }
    if (row.commitSeq !== null) positioned(row.record.scope, row.commitSeq);
    if (row.record.ref.sourceVersion > 1) {
      const previous = sources.get(sourceRefKey({ sourceId: row.record.ref.sourceId, sourceVersion: row.record.ref.sourceVersion - 1 }));
      if (!previous || !sameScope(previous.record.scope, row.record.scope) || previous.record.kind !== row.record.kind) throw new Error('CORE2_IMPORT_INVALID_SOURCE');
    }
    if (row.commitSeq !== 0) {
      const operation = operations.get(scopedId(row.record.scope, row.record.operationId));
      if (!operation ? !(row.commitSeq === null && sameScope(row.record.scope, value.manifest.scope) && value.jobs.some(job => isRegisteredStagedJobSource(row.record, job.record)))
        : row.commitSeq !== null && (operation.status !== 'committed' || operation.receipt?.coreSeq !== row.commitSeq)) throw new Error('CORE2_IMPORT_SOURCE_POSITION');
    }
  }
  for (const event of value.events) {
    const scope = { journeyId: event.journeyId, branchId: event.branchId };
    positioned(scope, event.commitSeq); evidenceReachable(event.evidenceRefs, scope, event.commitSeq);
    if (event.replyToEventId && !eventReachable(event.replyToEventId, scope, event.commitSeq - 1)) throw new Error('CORE2_IMPORT_REPLY_PROVENANCE');
    const operation = operations.get(scopedId(scope, event.operationId));
    if (!operation || operation.status !== 'committed' || operation.receipt?.coreSeq !== event.commitSeq || !operation.receipt.eventIds.includes(event.eventId)) throw new Error('CORE2_IMPORT_RECEIPT');
  }
  const effects = value.events.flatMap(event => event.committedChanges.map(change => ({ scope: { journeyId: event.journeyId, branchId: event.branchId }, seq: event.commitSeq, key: change.effectKey })));
  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i]!;
    if (effects.some((other, j) => j !== i && other.key === effect.key && reachable(effect.scope, effect.seq, other.scope, other.seq))) throw new Error('CORE2_IMPORT_EFFECT_REPLAY');
  }
  for (const operation of value.operations) {
    const head = branches.get(scopeId(operation.scope))?.state.head;
    if (!head) throw new Error('CORE2_IMPORT_LINEAGE');
    sourceReachable(operation.sourceRefs, operation.scope, operation.receipt?.coreSeq ?? head.coreSeq, operation.status === 'committed' ? undefined : operation.operationId);
    if (operation.status !== 'committed') { if (operation.receipt) throw new Error('CORE2_IMPORT_RECEIPT'); continue; }
    const receipt = operation.receipt;
    if (!receipt || !['committed', 'already_committed'].includes(receipt.status) || receipt.operationId !== operation.operationId || !sameScope(receipt.scope, operation.scope)) throw new Error('CORE2_IMPORT_RECEIPT');
    positioned(operation.scope, receipt.coreSeq);
    const ownEvents = value.events.filter(row => row.operationId === operation.operationId && row.branchId === operation.scope.branchId);
    if (!sameData([...receipt.eventIds].sort(), ownEvents.map(row => row.eventId).sort()) || !unique(receipt.eventIds, id => id) ||
      !sameData([...operation.effects].sort(), ownEvents.flatMap(row => row.committedChanges.map(change => change.effectKey)).sort()) || !unique(operation.effects, id => id)) throw new Error('CORE2_IMPORT_RECEIPT');
    for (const id of receipt.jobIds) if (!value.jobs.some(job => job.record.jobId === id && sameScope(job.record.scope, operation.scope) && job.record.operationId === operation.operationId)) throw new Error('CORE2_IMPORT_RECEIPT');
  }
  for (const row of value.knowledge) {
    positioned(row.record.scope, row.commitSeq); evidenceReachable(row.record.evidenceRefs, row.record.scope, row.commitSeq);
    if (!eventReachable(row.record.eventId, row.record.scope, row.commitSeq)) throw new Error('CORE2_IMPORT_KNOWLEDGE_PROVENANCE');
  }
  for (const row of value.commitments) {
    positioned(row.record.scope, row.commitSeq);
    if (!eventReachable(row.record.establishedEventId, row.record.scope, row.commitSeq) || row.record.history.some(history => !eventReachable(history.eventId, row.record.scope, row.commitSeq))) throw new Error('CORE2_IMPORT_COMMITMENT_PROVENANCE');
  }
  for (const row of value.memories) {
    positioned(row.record.scope, row.commitSeq, row.publishedRevision);
    try { sourceReachable(row.record.sourceRefs, row.record.scope, row.commitSeq); }
    catch { throw new Error('CORE2_IMPORT_MEMORY_PROVENANCE'); }
    if (row.record.eventIds.some(id => !eventReachable(id, row.record.scope, row.commitSeq))) throw new Error('CORE2_IMPORT_MEMORY_PROVENANCE');
    for (const ref of row.record.memoryRefs) {
      const parent = value.memories.find(item => item.record.memoryId === ref.memoryId && item.record.version === ref.version &&
        reachable(row.record.scope, row.commitSeq, item.record.scope, item.commitSeq, row.publishedRevision, item.publishedRevision));
      if (!parent || parent.publishedRevision >= row.publishedRevision && sameScope(parent.record.scope, row.record.scope)) throw new Error('CORE2_IMPORT_MEMORY_PROVENANCE');
    }
  }
  // Follow references, not text similarity; a cycle cannot become valid evidence.
  const visitMemory = (row: ImportedMemory, active: Set<string>, done: Set<string>) => {
    const key = `${scopedId(row.record.scope, row.record.memoryId)}/${row.record.version}`;
    if (active.has(key)) throw new Error('CORE2_IMPORT_MEMORY_PROVENANCE');
    if (done.has(key)) return; active.add(key);
    for (const ref of row.record.memoryRefs) {
      const parent = value.memories.find(item => item.record.memoryId === ref.memoryId && item.record.version === ref.version &&
        reachable(row.record.scope, row.commitSeq, item.record.scope, item.commitSeq, row.publishedRevision, item.publishedRevision));
      if (!parent) throw new Error('CORE2_IMPORT_MEMORY_PROVENANCE'); visitMemory(parent, active, done);
    }
    active.delete(key); done.add(key);
  };
  const visited = new Set<string>(); for (const row of value.memories) visitMemory(row, new Set(), visited);

  const retryJobs = new Map(value.jobs.map(row => [scopedId(row.record.scope, row.record.jobId), row]));
  for (const job of value.jobs) {
    const record = job.record, chain = new Set([record.jobId]);
    let current = record;
    while (current.retriedByJobId) {
      const next = retryJobs.get(scopedId(current.scope, current.retriedByJobId));
      if (!next || chain.has(next.record.jobId) || next.record.retryOfJobId !== current.jobId || !['failed', 'cancelled'].includes(current.status)
        || current.kind !== next.record.kind || current.operationId !== next.record.operationId || !sameData(current.sourceRefs, next.record.sourceRefs)) throw Error('CORE2_IMPORT_JOB_RETRY');
      chain.add(next.record.jobId); current = next.record;
    }
    if (record.retryOfJobId) {
      const previous = retryJobs.get(scopedId(record.scope, record.retryOfJobId));
      if (!previous || previous.record.retriedByJobId !== record.jobId || previous.commitSeq > job.commitSeq) throw Error('CORE2_IMPORT_JOB_RETRY');
    }
    if (job.record.publicationReceipt !== undefined && (!job.publication || !sameData(job.record.publicationReceipt, job.publication.receipt))) throw new Error('CORE2_IMPORT_JOB_PUBLICATION');
    positioned(job.record.scope, job.commitSeq); sourceReachable(job.record.sourceRefs, job.record.scope, job.commitSeq);
    if (!Array.isArray(job.leaseIds) || !unique(job.leaseIds, id => id)) throw new Error('CORE2_IMPORT_JOB');
    job.leaseIds.forEach(assertId);
    if (job.record.status === 'running' || job.record.leaseId && !job.leaseIds.includes(job.record.leaseId)) throw new Error('CORE2_IMPORT_JOB');
    const operation = operations.get(scopedId(job.record.scope, job.record.operationId));
    if (!operation || operation.status !== 'committed') throw new Error('CORE2_IMPORT_JOB');
    for (const step of job.record.steps) if (step.jobId !== job.record.jobId || !job.leaseIds.includes(step.leaseId) || !sameScope(step.scope, job.record.scope) || !sameData(step.sourceRefs, job.record.sourceRefs)) throw new Error('CORE2_IMPORT_JOB');
    if (job.publication) {
      const pub = job.publication;
      dataFields(pub, ['leaseId', 'fingerprint', 'descriptor', 'receipt'], 'CORE2_IMPORT_JOB_PUBLICATION');
      dataFields(pub.receipt, ['status', 'memoryRevision', 'memoryIds'], 'CORE2_IMPORT_JOB_PUBLICATION');
      if (!Array.isArray(pub.receipt.memoryIds) || !unique(pub.receipt.memoryIds, id => id) || !Number.isSafeInteger(pub.receipt.memoryRevision)) throw new Error('CORE2_IMPORT_JOB_PUBLICATION');
      const additions = value.memories.filter(row => sameScope(row.record.scope, job.record.scope) && row.publishedRevision === pub.receipt.memoryRevision && pub.receipt.memoryIds.includes(row.record.memoryId)).map(row => row.record);
      const orderedAdditions = pub.receipt.memoryIds.map(id => { const row = additions.find(row => row.memoryId === id); if (!row) throw new Error('CORE2_IMPORT_JOB_PUBLICATION'); return row; });
      const patch = { ...pub.descriptor, additions: orderedAdditions };
      if (pub.receipt.status !== 'published' || !job.leaseIds.includes(pub.leaseId) || !sameScope(pub.descriptor.scope, job.record.scope) || pub.descriptor.jobId !== job.record.jobId || pub.descriptor.leaseId !== pub.leaseId ||
        additions.length !== pub.receipt.memoryIds.length || !sameData(pub.descriptor.sourceRefs, job.record.sourceRefs) || !ownDto('derived', patch) || checksumUtf8(stableJson(patch)) !== pub.fingerprint) throw new Error('CORE2_IMPORT_JOB_PUBLICATION');
    }
  }

  for (const snapshot of value.snapshots) {
    positioned(snapshot.scope, snapshot.coreSeq);
    const head = branches.get(scopeId(snapshot.scope))!.state.head;
    if (snapshot.memoryRevision > head.memoryRevision || snapshot.checksum !== checksumUtf8(stableJson(snapshot.state)) ||
      !sameData(snapshot.state.head.parent ?? null, head.parent ?? null) || snapshot.state.head.forkSeq !== head.forkSeq || snapshot.state.head.forkMemoryRevision !== head.forkMemoryRevision) throw new Error('CORE2_IMPORT_SNAPSHOT');
  }
  for (const branch of value.branches) {
    const head = branch.state.head;
    if (!unique(branch.state.records, refKey) || !unique(branch.state.tombstones ?? [], refKey) || (branch.state.tombstones ?? []).some(ref => branch.state.records.some(row => refKey(row) === refKey(ref))) ||
      !branch.state.records.some(row => row.domain === 'traveler' && row.entityId === branch.playerId)) throw new Error('CORE2_IMPORT_STATE');
    let baseline: SnapshotRecord | undefined;
    if (head.parent) {
      baseline = branch.originSnapshotId ? snapshots.get(branch.originSnapshotId) : undefined;
      if (!baseline || !sameScope(baseline.scope, head.parent) || baseline.coreSeq !== head.forkSeq || baseline.memoryRevision !== head.forkMemoryRevision) throw new Error('CORE2_IMPORT_LINEAGE');
    } else baseline = value.snapshots.find(row => sameScope(row.scope, head.scope) && row.coreSeq === 0 && row.memoryRevision === 0);
    if (!baseline) throw new Error('CORE2_IMPORT_BASELINE');
    const state = new Map<string, { record: StateRecord | null; ref: RecordRef }>();
    for (const record of baseline.state.records) state.set(refKey(record), { record: { ...record, scope: head.scope }, ref: { domain: record.domain, entityId: record.entityId, version: record.version } });
    for (const ref of baseline.state.tombstones ?? []) state.set(refKey(ref), { record: null, ref });
    const actual = (): CoreSnapshot => ({ head, contentRefs: baseline.state.contentRefs,
      records: [...state.values()].flatMap(row => row.record ? [row.record] : []),
      tombstones: [...state.values()].filter(row => !row.record).map(row => row.ref) });
    const checkSnapshots = (seq: number) => {
      for (const snapshot of value.snapshots.filter(row => sameScope(row.scope, head.scope) && row.coreSeq === seq))
        if (!sameData(projection(snapshot.state), projection(actual()))) throw new Error('CORE2_IMPORT_SNAPSHOT_STATE');
    };
    const baseSeq = head.forkSeq ?? 0; checkSnapshots(baseSeq);
    const ordered = value.operations.filter(op => sameScope(op.scope, head.scope) && op.status === 'committed').sort((a, b) => a.receipt!.coreSeq - b.receipt!.coreSeq);
    if (ordered.length !== head.coreSeq - baseSeq) throw new Error('CORE2_IMPORT_COMMIT_GAP');
    let seq = baseSeq;
    for (const operation of ordered) {
      if (operation.receipt!.coreSeq !== ++seq) throw new Error('CORE2_IMPORT_COMMIT_GAP');
      for (const read of operation.readSet) if ((state.get(refKey(read))?.ref.version ?? 0) !== read.version) throw new Error('CORE2_IMPORT_STATE_HISTORY');
      const changes = value.events.filter(event => event.operationId === operation.operationId && event.branchId === head.scope.branchId).flatMap(event => event.committedChanges);
      if (!unique(changes, change => refKey(change.ref))) throw new Error('CORE2_IMPORT_STATE_HISTORY');
      for (const change of changes) {
        const current = state.get(refKey(change.ref));
        if (!operation.readSet.some(ref => sameData(ref, change.ref)) || !sameData(current?.record ?? null, change.before) || (current?.ref.version ?? 0) !== change.ref.version ||
          change.after && (change.after.version !== change.ref.version + 1 || refKey(change.after) !== refKey(change.ref) || !sameScope(change.after.scope, head.scope))) throw new Error('CORE2_IMPORT_STATE_HISTORY');
        state.set(refKey(change.ref), { record: change.after, ref: { ...change.ref, version: change.ref.version + 1 } });
      }
      checkSnapshots(seq);
    }
    if (!sameData(projection(branch.state), projection(actual()))) throw new Error('CORE2_IMPORT_STATE_HISTORY');
  }
  const chosen = snapshots.get(value.manifest.snapshotId);
  if (!chosen || !sameScope(chosen.scope, value.manifest.scope) || !sameData(chosen.state, selected.state)) throw new Error('CORE2_IMPORT_SNAPSHOT');
  for (const slot of value.slots) if (slot.journeyId !== journeyId || !snapshots.has(slot.snapshotId)) throw new Error('CORE2_IMPORT_SLOT');
  for (const asset of value.assets) if (!branches.has(scopeId(asset.scope))) throw new Error('CORE2_IMPORT_ASSET_SCOPE');
  // Resource references are typed IDs in state; data/blob URLs were already rejected.
  const assetIds = new Set(value.assets.map(row => row.assetId));
  for (const row of value.sources) if (row.record.assetRefs) {
    if (row.record.kind !== 'image' || !unique(row.record.assetRefs, id => id) || row.record.assetRefs.some(id => !value.assets.some(asset => asset.assetId === id && sameScope(asset.scope, row.record.scope)))) throw Error('CORE2_IMPORT_IMAGE_ASSET');
  }
  const inspectState = (state: CoreSnapshot) => {
    for (const record of state.records) {
      if(stateAssetIds(record).some(id=>!assetIds.has(id))) throw new Error('CORE2_IMPORT_ASSET_MISSING');
      if (record.domain === 'album' && !assetIds.has(record.value.assetId)) throw new Error('CORE2_IMPORT_ASSET_MISSING');
      if (record.domain === 'album') sourceReachable(record.value.sourceRefs, state.head.scope, state.head.coreSeq);
      if (record.domain === 'album' && record.value.phoneOrigin) {
        const origin = record.value.phoneOrigin, anchor = events.get(origin.playerEventId), playerId = branches.get(scopeId(state.head.scope))!.playerId;
        if (!anchor || !eventReachable(anchor.eventId, state.head.scope, state.head.coreSeq) || anchor.actorIds.length !== 1 || anchor.actorIds[0] !== playerId || anchor.channelId !== origin.conversationId
          || !['communication.private', 'communication.group'].includes(anchor.type) || !anchor.targetIds.includes(origin.npcId) || record.value.kind !== 'character' || !sameData(record.value.npcIds, [origin.npcId])
          || ![...events.values()].some(reply => reply.replyToEventId === anchor.eventId && reply.channelId === origin.conversationId && reply.type === anchor.type && sameData(reply.actorIds, [origin.npcId]) && eventReachable(reply.eventId, state.head.scope, state.head.coreSeq))) throw Error('CORE2_IMPORT_PHONE_PHOTO');
      }
      if (record.domain === 'news') { sourceReachable([record.value.sourceRef], state.head.scope, state.head.coreSeq); if (record.value.eventIds.some(id => !eventReachable(id, state.head.scope, state.head.coreSeq))) throw new Error('CORE2_IMPORT_STATE_PROVENANCE'); }
      if (record.domain === 'courier' && record.value.kind === 'contact' && record.value.avatarAssetId && !assetIds.has(record.value.avatarAssetId)) throw new Error('CORE2_IMPORT_ASSET_MISSING');
      if (record.domain === 'courier' && record.value.kind === 'moment') { sourceReachable([record.value.sourceRef], state.head.scope, state.head.coreSeq); if (record.value.imageAssetIds.some(id => !assetIds.has(id))) throw new Error('CORE2_IMPORT_ASSET_MISSING'); }
    }
  };
  value.branches.forEach(row => inspectState(row.state)); value.snapshots.forEach(row => inspectState(row.state));
}
