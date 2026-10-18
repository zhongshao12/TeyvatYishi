import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { recoverCoreOperation } from '@/core/settlement/operationRecovery';
import { makeSeed } from './fixtures';

describe('core2 explicit operation recovery', () => {
  it('inspects unknown, draft and cancelled operations without creating sources or sending models', async () => {
    const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-recover-${crypto.randomUUID()}` });
    const seed = makeSeed(); await repo.initialize(seed);
    const prepare = vi.spyOn(repo, 'prepareOperation');
    expect(await recoverCoreOperation(repo, seed.head.scope, 'unknown')).toMatchObject({ kind: 'not_found' });
    await repo.prepareOperation({ scope: seed.head.scope, operationId: 'draft', kind: 'main', status: 'draft', sourceRefs: [], readSet: [], candidateRefs: [], effects: [], attempts: 0 });
    prepare.mockClear();
    expect(await recoverCoreOperation(repo, seed.head.scope, 'draft')).toMatchObject({ kind: 'needs_extraction' });
    expect(prepare).not.toHaveBeenCalled();
    await repo.cancelOperation(seed.head.scope, 'draft');
    expect(await recoverCoreOperation(repo, seed.head.scope, 'draft')).toMatchObject({ kind: 'cancelled' });
  });
});
