import type { CoreRepository, ImportedSource } from '../contracts/storage';
import type { OperationRecord } from '../contracts/operation';
import { ownDto, sameData, sameScope, sourceKey, sourceRefKey, scopeKey, unique } from './repositoryValidation';
import { branch } from './indexedScope';
import { request, transact } from './indexedTransaction';
import { sourcePosition } from './sourcePositions';

export function createIndexedOperationSourceMethods(database: () => Promise<IDBDatabase>): Pick<CoreRepository, 'appendOperationSource'> {
  return { async appendOperationSource(input) {
    const value = ownDto('operationSourceAppend', input), { source } = value;
    if (source.kind !== 'narrative' || source.operationId !== value.operationId || source.ref.sourceVersion !== 1 || !unique(source.blocks, block => block.blockId)) throw Error('CORE2_INVALID_OPERATION_SOURCE');
    const db = await database();
    return transact(db, ['branches', 'sources', 'sourcePositions', 'operations'], 'readwrite', async tx => {
      const current = await branch(tx, value.scope);
      if (current.head.sessionId !== value.sessionId) throw Error('CORE2_SESSION_CHANGED');
      const operations = tx.objectStore('operations'), key = [...scopeKey(value.scope), value.operationId];
      const operation = await request<OperationRecord | undefined>(operations.get(key));
      if (!operation || operation.kind !== 'main' || operation.status !== 'draft' || operation.stage) throw Error('CORE2_OPERATION_NOT_OPEN');
      const sources = tx.objectStore('sources');
      for (const ref of operation.sourceRefs) {
        const stored = await request<ImportedSource | undefined>(sources.get(sourceKey(ref)));
        if (!stored || !sameScope(stored.record.scope, value.scope) || stored.record.operationId !== value.operationId) throw Error('CORE2_OPERATION_SOURCE_MISMATCH');
        if (stored.record.kind === 'narrative') {
          if (sourceRefKey(ref) !== sourceRefKey(source.ref) || !sameData(stored.record, source)) throw Error('CORE2_NARRATIVE_ALREADY_FROZEN');
          return operation;
        }
      }
      const previous = await request<ImportedSource | undefined>(sources.get(sourceKey(source.ref)));
      if (previous && (!sameData(previous.record, source) || previous.commitSeq !== null)) throw Error('CORE2_SOURCE_IMMUTABLE');
      if (!previous) {
        await request(sources.add({ record: source, commitSeq: null } satisfies ImportedSource));
        await request(tx.objectStore('sourcePositions').add(sourcePosition(source, null)));
        await request(tx.objectStore('branches').put({ ...current, sourceCount: current.sourceCount + 1 }));
      }
      const next = { ...operation, sourceRefs: [...operation.sourceRefs, source.ref] };
      await request(operations.put(next));
      return next;
    });
  } };
}
