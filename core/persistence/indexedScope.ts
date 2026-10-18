import type { BranchHead, ContentRef, CoreScope } from '../contracts/identity';
import type { OperationRecord } from '../contracts/operation';
import { ownDto, sameScope, scopeKey } from './repositoryValidation';
import { request } from './indexedTransaction';

export interface StoredBranch { head: BranchHead; playerId: string; contentRefs: ContentRef[]; sourceCount:number; originSnapshotId?: string; checkpointId?: string }
export interface FrozenScope { scope: CoreScope; cutoffSeq: number; memoryRevision: number }

export async function branch(tx: IDBTransaction, scope: CoreScope): Promise<StoredBranch> {
  const found = await request<StoredBranch | undefined>(tx.objectStore('branches').get(scopeKey(scope)));
  if (!found) throw new Error('CORE2_BRANCH_NOT_FOUND');
  if (!sameScope(ownDto('head', found.head).scope, scope)) throw new Error('CORE2_BRANCH_CORRUPT');
  return found;
}

/** Derived from durable heads only. Each ancestor is clipped at BOTH fork positions. */
export async function branchPath(tx: IDBTransaction, scope: CoreScope, cutoffSeq?: number, memoryRevision?: number): Promise<FrozenScope[]> {
  let current = await branch(tx, scope);
  let seq = cutoffSeq ?? current.head.coreSeq, revision = memoryRevision ?? current.head.memoryRevision;
  if (seq > current.head.coreSeq || revision > current.head.memoryRevision) throw new Error('CORE2_FUTURE_CUTOFF');
  const path: FrozenScope[] = [], seen = new Set<string>();
  while (true) {
    const head = current.head;
    if (head.scope.journeyId !== scope.journeyId || seen.has(head.scope.branchId) || seq > head.coreSeq || revision > head.memoryRevision) throw new Error('CORE2_BRANCH_LINEAGE_CORRUPT');
    seen.add(head.scope.branchId);
    path.push({ scope: head.scope, cutoffSeq: seq, memoryRevision: revision });
    if (!head.parent) return path;
    seq = Math.min(seq, head.forkSeq!);
    revision = Math.min(revision, head.forkMemoryRevision!);
    current = await branch(tx, head.parent);
  }
}

export function withinPath(path: FrozenScope[], scope: CoreScope, commitSeq: number, publishedRevision?: number): boolean {
  const bound = path.find(entry => sameScope(entry.scope, scope));
  return !!bound && Number.isSafeInteger(commitSeq) && commitSeq >= 0 && commitSeq <= bound.cutoffSeq &&
    (publishedRevision === undefined || Number.isSafeInteger(publishedRevision) && publishedRevision >= 0 && publishedRevision <= bound.memoryRevision);
}

export async function operationForScope(tx: IDBTransaction, scope: CoreScope, operationId: string): Promise<OperationRecord | undefined> {
  const path = await branchPath(tx, scope);
  const store = tx.objectStore('operations');
  const own = await request<OperationRecord | undefined>(store.get([...scopeKey(scope), operationId]));
  if (own?.status === 'committed') return own;
  for (const bound of path.slice(1)) {
    const operation = await request<OperationRecord | undefined>(store.get([...scopeKey(bound.scope), operationId]));
    if (operation?.status === 'committed' && operation.receipt &&
      (operation.receipt.status === 'committed' || operation.receipt.status === 'already_committed') && operation.receipt.coreSeq <= bound.cutoffSeq) return operation;
  }
  return own;
}

export async function entityVersions<T extends { commitSeq: number; publishedRevision?: number }>(tx: IDBTransaction,
  storeName: 'knowledge' | 'commitments' | 'memories', scope: CoreScope, entityId: string): Promise<T[]> {
  const rows: T[] = [];
  for (const bound of await branchPath(tx, scope)) {
    const versions = await request<T[]>(tx.objectStore(storeName).index('by_entity').getAll([...scopeKey(bound.scope), entityId]));
    rows.push(...versions.filter(row => row.commitSeq <= bound.cutoffSeq && (storeName !== 'memories' ||
      row.publishedRevision !== undefined && row.publishedRevision <= bound.memoryRevision)));
  }
  return rows;
}
