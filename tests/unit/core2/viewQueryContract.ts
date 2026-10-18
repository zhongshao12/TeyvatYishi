import { expect, it } from 'vitest';
import type { CoreRepository } from '@/core/contracts/storage';
import { makeSeed } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';

export function assertViewQueryContract(factory: () => Promise<CoreRepository>): void {
  it('pages technical failures separately without reading original source bodies', async () => {
    const repo = await factory(), seed = makeSeed(); await repo.initialize(seed);
    for (let i = 0; i < 51; i++) await repo.cancelOperation(seed.head.scope, `view-cancel-${String(i).padStart(3, '0')}`);
    const page = await repo.queryOperations({ scope: seed.head.scope, cutoffSeq: 0, statuses: ['cancelled'] });
    expect(page.items).toHaveLength(50); expect(page.nextCursor).toBeTruthy();
    const next = await repo.queryOperations({ scope: seed.head.scope, cutoffSeq: 0, statuses: ['cancelled'], cursor: page.nextCursor });
    expect(next.items).toHaveLength(1); expect(next.items[0]!.operationId).toBe('view-cancel-050');
  });
  it('queries exact jobs and stable phone channels, not display names', async () => {
    const repo = await factory(), seed = makeSeed(); await repo.initialize(seed);
    const batch = makeBatch(seed); batch.events[0]!.channelId = 'channel-a'; batch.events[0]!.sourceOrder = 2;
    batch.events.push({ ...structuredClone(batch.events[0]!), eventId: 'earlier-message', sourceOrder: 0, committedChanges: [] });
    await prepareBatch(repo, batch); await repo.commit(batch);
    expect((await repo.queryEvents({ scope: seed.head.scope, cutoffSeq: 1, channelIds: ['channel-b'] })).items).toEqual([]);
    expect((await repo.queryEvents({ scope: seed.head.scope, cutoffSeq: 1, channelIds: ['channel-a'] })).items.map(row => row.eventId)).toEqual(['earlier-message', batch.events[0]!.eventId]);
    expect((await repo.queryEvents({ scope: seed.head.scope, cutoffSeq: 1, channelIds: ['channel-a'], direction: 'desc' })).items.map(row => row.eventId)).toEqual([batch.events[0]!.eventId, 'earlier-message']);
    expect((await repo.queryJobs({ scope: seed.head.scope, cutoffSeq: 1, jobIds: ['missing'] })).items).toEqual([]);
    expect((await repo.queryJobs({ scope: seed.head.scope, cutoffSeq: 1, jobIds: [batch.jobs[0]!.jobId] })).items).toHaveLength(1);
  });
}
