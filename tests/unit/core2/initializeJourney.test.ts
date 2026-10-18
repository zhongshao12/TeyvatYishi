import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { initializeCoreJourney } from '@/core/settlement/initializeJourney';
import { makeSeed } from './fixtures';

describe('core2 clean journey initialization', () => {
  it('isolates same-name journeys and initializes only the explicit seed', async () => {
    const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-init-${crypto.randomUUID()}` });
    const a = makeSeed(), b = makeSeed();
    b.records = b.records.filter(r => !['npc', 'courier', 'inventory', 'news', 'album', 'quest'].includes(r.domain));
    await initializeCoreJourney(repo, a); await initializeCoreJourney(repo, b);
    const state = await repo.readState(b.head.scope);
    expect(state.records.some(r => r.domain === 'npc' || r.domain === 'courier' || r.domain === 'inventory')).toBe(false);
    expect(state.head.scope).not.toEqual(a.head.scope);
    expect(await repo.queryJobs({ scope: b.head.scope, cutoffSeq: 0 })).toMatchObject({ items: [] });
  });
  it('rejects a nonzero or cross-scope baseline rather than converting an old root', async () => {
    const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-init-invalid-${crypto.randomUUID()}` });
    const seed = makeSeed(); seed.head.coreSeq = 1;
    await expect(initializeCoreJourney(repo, seed)).rejects.toThrow('CORE2_INVALID_JOURNEY_SEED');
  });
});
