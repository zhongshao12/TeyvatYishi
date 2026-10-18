import type { CoreRepository, IndexPatch, IndexPosting, IndexReceipt, IndexStatus } from '../contracts/storage';
import type { BranchHead, CoreScope } from '../contracts/identity';
import type { GameEvent } from '../contracts/event';
import type { MemoryRecord } from '../contracts/memory';
import { branch, branchPath, withinPath } from './indexedScope';
import type { FrozenScope } from './indexedScope';
import { request, transact } from './indexedTransaction';
import { ownDto, scopeKey, unique } from './repositoryValidation';
import { paged } from './pagination';
import { readKeyedPostingPage } from './indexedPostingPage';

export type IndexFaultPoint = 'index:postings' | 'index:meta';
interface PositionedMemory { scope: CoreScope; commitSeq: number; publishedRevision: number; record: MemoryRecord }

function indexStatus(head: BranchHead, saved?: IndexStatus): IndexStatus {
  if (!saved) return { scope: head.scope, coreSeq: 0, memoryRevision: 0, indexVersion: 0, status: 'missing' };
  const value = ownDto('indexStatus', saved);
  if (value.coreSeq > head.coreSeq || value.memoryRevision > head.memoryRevision || value.indexVersion === 0) throw new Error('CORE2_INDEX_CORRUPT');
  return { ...value, status: value.coreSeq === head.coreSeq && value.memoryRevision === head.memoryRevision ? 'ready' : 'lagging' };
}

async function targetValid(tx: IDBTransaction, posting: IndexPosting, path: FrozenScope[]): Promise<boolean> {
  if (posting.target === 'event') {
    const event = await request<GameEvent | undefined>(tx.objectStore('events').get(posting.targetId));
    return !!event && posting.memoryRevision === 0 && posting.commitSeq === event.commitSeq &&
      withinPath(path, { journeyId: event.journeyId, branchId: event.branchId }, event.commitSeq);
  }
  let latest: PositionedMemory | undefined;
  for (const bound of path) {
    const versions = await request<PositionedMemory[]>(tx.objectStore('memories').index('by_entity').getAll([...scopeKey(bound.scope), posting.targetId]));
    for (const value of versions) if (withinPath(path, value.scope, value.commitSeq, value.publishedRevision) &&
      (!latest || value.record.version > latest.record.version)) latest = value;
  }
  return !!latest && latest.commitSeq === posting.commitSeq && latest.publishedRevision === posting.memoryRevision;
}

function deleteScopePostings(store: IDBObjectStore, scope: CoreScope,targets?:Set<string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const cursor = store.index('by_scope').openCursor(scopeKey(scope));
    cursor.onerror = () => reject(cursor.error);
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) { resolve(); return; }
      if(targets && !targets.has(JSON.stringify([row.value.target,row.value.targetId]))) {row.continue();return;}
      const deletion = store.delete(row.primaryKey);
      deletion.onerror = () => reject(deletion.error);
      deletion.onsuccess = () => row.continue();
    };
  });
}

/** Cache only. A posting never grants NPC visibility or establishes a game fact. */
export function createIndexedIndexMethods(database: () => Promise<IDBDatabase>, fault: (point: IndexFaultPoint) => void): Pick<CoreRepository, 'readIndexStatus' | 'publishIndex'|'queryPostings'> {
  return {
    async readIndexStatus(input: CoreScope): Promise<IndexStatus> {
      const scope = ownDto('scope', input), db = await database();
      return transact(db, ['branches', 'indexMeta'], 'readonly', async tx => {
        const current = await branch(tx, scope);
        return indexStatus(current.head, await request<IndexStatus | undefined>(tx.objectStore('indexMeta').get(scopeKey(scope))));
      });
    },

    async publishIndex(input: IndexPatch): Promise<IndexReceipt> {
      const patch = ownDto('indexPatch', input), db = await database();
      return transact(db, ['branches', 'indexMeta', 'postings', 'events', 'memories'], 'readwrite', async tx => {
        const current = await branch(tx, patch.scope), store = tx.objectStore('indexMeta');
        const previous = indexStatus(current.head, await request<IndexStatus | undefined>(store.get(scopeKey(patch.scope))));
        const rejected = (status: 'conflict' | 'cancelled', reason: string): IndexReceipt => ({ status, reason, indexVersion: previous.indexVersion });
        if (current.head.sessionId !== patch.sessionId) return rejected('cancelled', 'session_changed');
        if (previous.indexVersion !== patch.expectedIndexVersion) return rejected('conflict', 'index_version_changed');
        if (patch.cutoffSeq > current.head.coreSeq || patch.memoryRevision > current.head.memoryRevision) return rejected('conflict', 'future_index_position');
        if (patch.cutoffSeq < previous.coreSeq || patch.memoryRevision < previous.memoryRevision) return rejected('conflict', 'index_position_regressed');
        if (!unique(patch.postings, row => JSON.stringify([row.kind, row.key, row.target, row.targetId]))) return rejected('conflict', 'duplicate_index_posting');
        const path = await branchPath(tx, patch.scope, patch.cutoffSeq, patch.memoryRevision);
        // A target has many terms, but its frozen position is the same for all
        // of them. Do not deserialize the same event once per keyword. Include
        // both positions in the cache key so a forged posting cannot piggyback
        // on the validation of a different version of that target.
        const validated = new Set<string>();
        for (const posting of patch.postings) {
          const key = JSON.stringify([posting.target, posting.targetId, posting.commitSeq, posting.memoryRevision]);
          if (validated.has(key)) continue;
          if (!await targetValid(tx, posting, path)) return rejected('conflict', 'invalid_index_target');
          validated.add(key);
        }
        if(patch.replacedTargets && patch.mode!=='merge') return rejected('conflict','invalid_index_merge');
        const targets=new Set([...(patch.replacedTargets??[]),...patch.postings].map(row=>JSON.stringify([row.target,row.targetId])));
        const postings = tx.objectStore('postings'); await deleteScopePostings(postings, patch.scope,patch.mode==='merge'?targets:undefined);
        for (const posting of patch.postings) await request(postings.add(posting));
        fault('index:postings');
        const next: IndexStatus = { scope: patch.scope, coreSeq: patch.cutoffSeq, memoryRevision: patch.memoryRevision, indexVersion: previous.indexVersion + 1, status: 'ready', ...(patch.contentVersion?{contentVersion:patch.contentVersion}:{}) };
        await request(store.put(next)); fault('index:meta');
        return { status: 'published', indexVersion: next.indexVersion };
      });
    },
    async queryPostings(input) {
      const query=ownDto('postingQuery',input),db=await database();
      return transact(db,['branches','indexMeta','postings'],'readonly',async tx=>{
        const current=await branch(tx,query.scope),status=indexStatus(current.head,await request<IndexStatus|undefined>(tx.objectStore('indexMeta').get(scopeKey(query.scope))));
        if(status.status!=='ready' || status.coreSeq!==query.cutoffSeq || status.memoryRevision!==query.memoryRevision) throw new Error('CORE2_INDEX_POSITION_MISMATCH');
        if (query.kind && query.keys) return readKeyedPostingPage(tx.objectStore('postings'), query);
        const rows = await request<IndexPosting[]>(tx.objectStore('postings').index('by_scope').getAll(scopeKey(query.scope)));
        const items=rows.map(row=>ownDto('indexPosting',row)).filter(row=>(!query.kind || row.kind===query.kind)&&(!query.keys || query.keys.includes(row.key))&&(!query.target || row.target===query.target))
          .sort((a,b)=>JSON.stringify([a.kind,a.key,a.target,a.targetId])<JSON.stringify([b.kind,b.key,b.target,b.targetId])?-1:1);
        return paged(items,query,row=>JSON.stringify([row.kind,row.key,row.target,row.targetId]));
      });
    },
  };
}
