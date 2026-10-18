import { describe, expect, it } from 'vitest';
import type { SourceQuery } from '@/core/contracts/storage';
import { makeSeed, makeSource } from './fixtures';
import { makeBatch, prepareBatch } from './repositoryContract';
import { capture, nextBatch, slotFor } from './snapshotRepositoryContract';

export function assertSourceQueryRepositoryContract(factory: () => Promise<import('./snapshotRepositoryContract').SnapshotRepositoryContract>): void {
describe('scoped immutable source queries', () => {
  async function scenario() {
    const repo = await factory();
    const seed = makeSeed(); await repo.initialize(seed);
    const batch = makeBatch(seed); await prepareBatch(repo, batch); await repo.commit(batch);
    expect(typeof repo.querySources).toBe('function');
    return { repo, seed, batch };
  }

  it('returns requested committed source versions and never exposes pending drafts', async () => {
    const { repo, batch } = await scenario();
    const pending = makeSource({ scope: batch.scope, operationId: 'operation-pending' }); await repo.putSource(pending);
    const page = await repo.querySources({ scope: batch.scope, cutoffSeq: 1, refs: [...batch.sourceRefs, pending.ref], kinds: ['narrative'] });
    expect(page.items.map(row => row.ref)).toEqual(batch.sourceRefs);
    expect(page.items[0]!.blocks[0]!.text).toBe('安柏把一枚苹果放入玩家背包。');
    expect((await repo.querySources({ scope: batch.scope, cutoffSeq: 1, refs: batch.sourceRefs, kinds: ['manual'] })).items).toEqual([]);
  });

  it('a child can read its past evidence, but not future ancestor or sibling sources', async () => {
    const { repo, batch } = await scenario();
    const snapshot = await capture(repo, batch.scope); await repo.publishSnapshot(snapshot, slotFor(snapshot));
    const child = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'child', sessionId: 'session-child' });
    const sibling = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'sibling', sessionId: 'session-sibling' });
    const future = await nextBatch(repo, batch.scope); await prepareBatch(repo, future); await repo.commit(future);
    const sideways = await nextBatch(repo, sibling.scope); await prepareBatch(repo, sideways); await repo.commit(sideways);
    expect((await repo.querySources({ scope: child.scope, cutoffSeq: 1, refs: [...batch.sourceRefs, ...future.sourceRefs, ...sideways.sourceRefs] })).items.map(row => row.ref)).toEqual(batch.sourceRefs);
  });

  it('an edited but uncommitted version does not replace the original evidence', async () => {
    const { repo, batch } = await scenario();
    const original = (await repo.readSource(batch.sourceRefs[0]!))!;
    const edited = { ...original, ref: { ...original.ref, sourceVersion: 2 }, operationId: 'operation-editing' };
    await repo.putSource(edited);
    const page = await repo.querySources({ scope: batch.scope, cutoffSeq: 1, refs: [original.ref, edited.ref] });
    expect(page.items.map(row => row.ref.sourceVersion)).toEqual([1]);
  });

  it('default source pages keep a stable cursor and a maximum of fifty records', async () => {
    const repo = await factory();
    const seed = makeSeed();
    for (let i = 0; i < 51; i++) seed.sources.push(makeSource({ scope: seed.head.scope, kind: 'initialization',
      ref: { sourceId: `source-page-${String(i).padStart(3, '0')}`, sourceVersion: 1 } }));
    await repo.initialize(seed); expect(typeof repo.querySources).toBe('function');
    const query: SourceQuery = { scope: seed.head.scope, cutoffSeq: 0, kinds: ['initialization'] };
    const first = await repo.querySources(query);
    expect(first.items).toHaveLength(50); expect(first.items[0]!.ref.sourceId).toBe('source-page-000');
    const next = await repo.querySources({ ...query, cursor: first.nextCursor! });
    expect(next.items.map(row => row.ref.sourceId)).toEqual(['source-page-050']);
    expect(next.nextCursor).toBeUndefined();
  });

  it('rejects malformed references and accessors before they can run', async () => {
    const { repo, batch } = await scenario();
    await expect(repo.querySources({ scope: batch.scope, cutoffSeq: 1, refs: [{ sourceId: 'source-one', sourceVersion: 0 }] })).rejects.toThrow('CORE2_INVALID_QUERY');
    let invoked = false;
    const input = { scope: batch.scope, cutoffSeq: 1, get operationId() { invoked = true; return 'operation-fixture'; } };
    await expect(repo.querySources(input)).rejects.toThrow('CORE2_INVALID_QUERY');
    expect(invoked).toBe(false);
  });

  it('new source versions cannot be based on a different branch, even within the same journey', async () => {
    const { repo, batch } = await scenario();
    const snapshot = await capture(repo, batch.scope); await repo.publishSnapshot(snapshot, slotFor(snapshot));
    const child = await repo.fork({ snapshotId: snapshot.snapshotId, parentScope: batch.scope, branchId: 'child', sessionId: 'session-child' });
    const original = (await repo.readSource(batch.sourceRefs[0]!))!;
    await expect(repo.putSource({ ...original, scope: child.scope, operationId: 'operation-child-edit',
      ref: { ...original.ref, sourceVersion: 2 } })).rejects.toThrow('CORE2_SOURCE_VERSION_CONFLICT');
  });

  it('commitment queries reject accessors before reading optional date filters', async () => {
    const { repo, batch } = await scenario();
    let invoked = false;
    const input = { scope: batch.scope, cutoffSeq: 1, get dueAt() { invoked = true; return undefined; } };
    await expect(repo.queryCommitments(input)).rejects.toThrow('CORE2_INVALID_QUERY');
    expect(invoked).toBe(false);
  });
});
}
