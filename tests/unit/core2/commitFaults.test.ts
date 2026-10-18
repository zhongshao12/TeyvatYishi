import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import type { RepositoryFaultPoint } from '@/core/persistence/indexedRepository';
import { makeSeed } from './fixtures';
import { appleQuantity, makeBatch, prepareBatch } from './repositoryContract';

describe('core2 commit fault boundaries', () => {
  const preCommitPoints: RepositoryFaultPoint[] = ['commit:states', 'commit:events', 'commit:knowledge', 'commit:commitments', 'commit:jobs', 'commit:receipt'];
  for (const failurePoint of preCommitPoints) it(`abort_has_no_half_event_state_receipt_or_job (${failurePoint})`, async () => {
    const options = { databaseName: `test-core2-fault-${crypto.randomUUID()}`, factory: new IDBFactory() };
    const repo = createIndexedRepository({ ...options, fault: point => { if (point === failurePoint) throw new Error('injected-write-failure'); } });
    const seed = makeSeed();
    await repo.initialize(seed);
    const batch = makeBatch(seed);
    await prepareBatch(repo, batch);
    await expect(repo.commit(batch)).rejects.toThrow('injected-write-failure');
    const recovered = createIndexedRepository(options);
    expect(await appleQuantity(recovered, seed)).toBe(1);
    expect((await recovered.readHead(batch.scope)).coreSeq).toBe(0);
    expect((await recovered.readOperation(batch.scope, batch.operationId))?.receipt).toBeUndefined();
    const query = { scope: batch.scope, cutoffSeq: 0 };
    expect((await recovered.queryEvents(query)).items).toEqual([]);
    expect((await recovered.queryKnowledge(query)).items).toEqual([]);
    expect((await recovered.queryCommitments(query)).items).toEqual([]);
    expect((await recovered.queryJobs(query)).items).toEqual([]);
    expect((await recovered.commit(batch)).status).toBe('committed');
    expect(await appleQuantity(recovered, seed)).toBe(2);
  });

  it('response_lost_returns_same_receipt without replaying the reward', async () => {
    const options = { databaseName: `test-core2-response-${crypto.randomUUID()}`, factory: new IDBFactory() };
    const repo = createIndexedRepository({ ...options, fault: point => { if (point === 'commit:complete') throw new Error('response-lost'); } });
    const seed = makeSeed();
    await repo.initialize(seed);
    const batch = makeBatch(seed);
    await prepareBatch(repo, batch);
    await expect(repo.commit(batch)).rejects.toThrow('response-lost');
    const recovered = createIndexedRepository(options);
    const receipt = (await recovered.readOperation(batch.scope, batch.operationId))!.receipt!;
    expect(receipt.status).toBe('committed');
    expect(await recovered.commit(batch)).toEqual({ ...receipt, status: 'already_committed' });
    expect(await appleQuantity(recovered, seed)).toBe(2);
  });

  it('initialization failure publishes no partial journey', async () => {
    const options = { databaseName: `test-core2-initialize-${crypto.randomUUID()}`, factory: new IDBFactory() };
    const repo = createIndexedRepository({ ...options, fault: point => { if (point === 'initialize:states') throw new Error('initialize-interrupted'); } });
    const seed = makeSeed();
    await expect(repo.initialize(seed)).rejects.toThrow('initialize-interrupted');
    const recovered = createIndexedRepository(options);
    await expect(recovered.readHead(seed.head.scope)).rejects.toThrow('CORE2_BRANCH_NOT_FOUND');
    await recovered.initialize(seed);
    expect(await appleQuantity(recovered, seed)).toBe(1);
  });
});
