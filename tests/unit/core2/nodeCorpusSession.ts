import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import type { CoreRepository } from '@/core/contracts/storage';
import { makeSeed } from './fixtures';
import type { CorpusSession } from './coreSessionHarness';

/** Node-only corpus entry: fake-indexeddb is never loaded by the browser harness. */
export function makeNodeRepository(databaseName: string): CoreRepository {
  if (!databaseName.startsWith('test-core2-')) throw Error('CORE2_TEST_NAMESPACE_REQUIRED');
  return createIndexedRepository({ factory: new IDBFactory(), databaseName });
}

export async function openCorpusSession(databaseName: string): Promise<CorpusSession> {
  const repo = makeNodeRepository(databaseName), seed = makeSeed();
  await repo.initialize(seed);
  const head = await repo.readHead(seed.head.scope);
  return { repo, seed, scope: seed.head.scope, sessionId: seed.head.sessionId, head, committedTurns: 0, databaseName };
}
