import type { CoreRepository, PreparedImport } from '../contracts/storage';
import { CORE2_STORES } from './indexedSchema';
import { ownPreparedImport, validateImportGraph } from './preparedImports';
import { ownDto, scopeKey } from './repositoryValidation';
import { request, transact } from './indexedTransaction';
import type { StoredBranch } from './indexedScope';
import { sourcePosition } from './sourcePositions';

export type ImportFaultPoint = 'import:states' | 'import:ledger' | 'import:derived' | 'import:assets' | 'import:heads';
export function createIndexedImportMethods(database: () => Promise<IDBDatabase>, fault: (point: ImportFaultPoint) => void): Pick<CoreRepository, 'importPrepared'> {
  return {
    async importPrepared(input: PreparedImport) {
      const value = ownPreparedImport(input); validateImportGraph(value); const db = await database();
      return transact(db, CORE2_STORES, 'readwrite', async tx => {
        const journeyId = value.manifest.scope.journeyId;
        if (await request(tx.objectStore('branches').index('by_journey').count(journeyId))) throw new Error('CORE2_JOURNEY_EXISTS');
        for (const row of value.branches) {
          for (const record of row.state.records) await request(tx.objectStore('states').add({ scope: record.scope, domain: record.domain, entityId: record.entityId, version: record.version, record }));
          for (const ref of row.state.tombstones ?? []) await request(tx.objectStore('states').add({ scope: row.state.head.scope, domain: ref.domain, entityId: ref.entityId, version: ref.version, record: null }));
        }
        fault('import:states');
        for (const source of value.sources) {await request(tx.objectStore('sources').add(source));await request(tx.objectStore('sourcePositions').add(sourcePosition(source.record,source.commitSeq)));}
        for (const operation of value.operations) await request(tx.objectStore('operations').add(operation));
        for (const event of value.events) {
          await request(tx.objectStore('events').add(event));
          for (const change of event.committedChanges) await request(tx.objectStore('effects').add({ scope: { journeyId: event.journeyId, branchId: event.branchId }, effectKey: change.effectKey, operationId: event.operationId, commitSeq: event.commitSeq }));
        }
        fault('import:ledger');
        for (const row of value.memories) await request(tx.objectStore('memories').add({ ...row, scope: row.record.scope }));
        for (const row of value.knowledge) await request(tx.objectStore('knowledge').add({ ...row, scope: row.record.scope, knowledgeId: row.record.knowledgeId, version: row.record.version }));
        for (const row of value.commitments) await request(tx.objectStore('commitments').add({ ...row, scope: row.record.scope, commitmentId: row.record.commitmentId, version: row.record.version }));
        for (const row of value.jobs) {
          const { publicationReceipt: _projection, ...record } = row.record;
          await request(tx.objectStore('jobs').add({ ...row, record, scope: record.scope }));
        }
        fault('import:derived');
        for (const asset of value.assets) await request(tx.objectStore('assets').add(asset));
        for (const snapshot of value.snapshots) await request(tx.objectStore('snapshots').add(snapshot));
        for (const slot of value.slots) await request(tx.objectStore('slots').add(slot));
        fault('import:assets');
        for (const row of value.branches) {
          const checkpoint = value.snapshots.filter(snapshot=>snapshot.scope.journeyId===row.state.head.scope.journeyId && snapshot.scope.branchId===row.state.head.scope.branchId && snapshot.coreSeq<=row.state.head.coreSeq && snapshot.memoryRevision<=row.state.head.memoryRevision)
            .sort((a,b)=>b.coreSeq-a.coreSeq || b.memoryRevision-a.memoryRevision)[0];
          if (!checkpoint) throw new Error('CORE2_IMPORT_BASELINE');
          await request(tx.objectStore('branches').add({ head: row.state.head, playerId: row.playerId, contentRefs: row.state.contentRefs,sourceCount:value.sources.filter(source=>source.record.scope.branchId===row.state.head.scope.branchId).length, checkpointId:checkpoint.snapshotId,
            ...(row.originSnapshotId ? { originSnapshotId: row.originSnapshotId } : {}) } satisfies StoredBranch));
        }
        fault('import:heads');
        const selected = value.branches.find(row => scopeKey(row.state.head.scope).join('/') === scopeKey(value.manifest.scope).join('/'));
        if (!selected) throw new Error('CORE2_IMPORT_HEAD_NOT_FOUND');
        return ownDto('head', selected.state.head);
      });
    },
  };
}
