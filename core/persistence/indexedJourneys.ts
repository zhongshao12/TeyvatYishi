import type { JourneyEntry, JourneyQuery } from '../contracts/storage';
import type { StateRecord } from '../contracts/state';
import type { StoredBranch } from './indexedScope';
import { request, transact } from './indexedTransaction';
import { ownDto, scopeKey, compareCoreIds } from './repositoryValidation';
import { paged } from './pagination';

/** Directory reads two small state records per visible branch, never chat or assets. */
export function createIndexedJourneyMethods(database: () => Promise<IDBDatabase>) {
  return { async queryJourneys(input: JourneyQuery) {
    const query = ownDto('journeyQuery', input);
    return transact(await database(), ['branches', 'states'], 'readonly', async tx => {
      const branches = await request<StoredBranch[]>(tx.objectStore('branches').getAll());
      const key = (row: StoredBranch) => scopeKey(row.head.scope).join('/');
      branches.sort((a, b) => compareCoreIds(key(a), key(b)));
      const page = paged(branches, query, key), items: JourneyEntry[] = [], states = tx.objectStore('states');
      for (const branch of page.items) {
        const scope = branch.head.scope, keys = await request<IDBValidKey[]>(states.index('by_scope').getAllKeys(scopeKey(scope)));
        const worldKeys = keys.filter(key => Array.isArray(key) && key[2] === 'world');
        if (worldKeys.length !== 1) throw Error('CORE2_JOURNEY_DIRECTORY_STATE');
        const player = (await request<{ record: StateRecord } | undefined>(states.get([...scopeKey(scope), 'traveler', branch.playerId])))?.record;
        const world = (await request<{ record: StateRecord } | undefined>(states.get(worldKeys[0]!)))?.record;
        if (player?.domain !== 'traveler' || world?.domain !== 'world') throw Error('CORE2_JOURNEY_DIRECTORY_STATE');
        items.push(ownDto('journeyEntry', { scope, name: player.value.姓名, turn: world.value.completedMainTurns, coreSeq: branch.head.coreSeq, ...(branch.head.parent ? { parentBranchId: branch.head.parent.branchId } : {}) }));
      }
      return { items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) };
    });
  } };
}
