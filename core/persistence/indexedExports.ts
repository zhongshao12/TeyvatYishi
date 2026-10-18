import type { CoreRepository, ExportRecords, ExportBranch } from '../contracts/storage';
import { CORE2_STORES } from './indexedSchema';
import { request, transact } from './indexedTransaction';
import { branch, branchPath } from './indexedScope';
import { ownDto, sameScope } from './repositoryValidation';
import { ownExportRecords } from './exportGraph';

export function createIndexedExportMethods(database: () => Promise<IDBDatabase>): Pick<CoreRepository, 'readExportRecords'> {
  return {
    async readExportRecords(input) {
      const scope = ownDto('scope', input), db = await database();
      return transact(db, CORE2_STORES, 'readonly', async tx => {
        const path = await branchPath(tx, scope), branches: ExportBranch[] = [];
        for (const bound of path) {
          const row = await branch(tx, bound.scope);
          branches.push({ playerId: row.playerId, head: row.head, ...(row.originSnapshotId ? { originSnapshotId: row.originSnapshotId } : {}) });
        }
        const inPath = (value: unknown) => path.some(bound => sameScope(bound.scope, value as typeof scope));
        const all = async <T>(store: typeof CORE2_STORES[number]) => request<T[]>(tx.objectStore(store).getAll());
        const records: ExportRecords = {
          scope, branches,
          sources: (await all<ExportRecords['sources'][number]>('sources')).filter(row => inPath(row.record.scope)),
          events: (await all<ExportRecords['events'][number]>('events')).filter(row => inPath({journeyId:row.journeyId,branchId:row.branchId})),
          operations: (await all<ExportRecords['operations'][number]>('operations')).filter(row => inPath(row.scope)),
          memories: (await all<ExportRecords['memories'][number]>('memories')).filter(row => inPath(row.record.scope)).map(({record,commitSeq,publishedRevision})=>({record,commitSeq,publishedRevision})),
          knowledge: (await all<ExportRecords['knowledge'][number]>('knowledge')).filter(row=>inPath(row.record.scope)).map(({record,commitSeq})=>({record,commitSeq})),
          commitments: (await all<ExportRecords['commitments'][number]>('commitments')).filter(row=>inPath(row.record.scope)).map(({record,commitSeq})=>({record,commitSeq})),
          jobs: (await all<ExportRecords['jobs'][number]>('jobs')).filter(row=>inPath(row.record.scope)).map(({record,commitSeq,leaseIds,publication})=>({record,commitSeq,leaseIds:leaseIds??[],...(publication?{publication}:{})})),
          snapshots: (await all<ExportRecords['snapshots'][number]>('snapshots')).filter(row=>inPath(row.scope)),
          slots: (await all<ExportRecords['slots'][number]>('slots')).filter(row=>row.journeyId===scope.journeyId),
          assets: (await all<ExportRecords['assets'][number]>('assets')).filter(row=>inPath(row.scope)),
        };
        return ownExportRecords(records);
      });
    },
  };
}
