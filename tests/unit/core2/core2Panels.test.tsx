// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { buildCoreView } from '@/core/retrieval/viewModels';
import { recallFixture } from './recallFixture';

it('reads paged memory projections without opening original bodies, then opens an explicit reachable source', async () => {
  const f = await recallFixture(1); for (let i = 0; i < 51; i++) await f.publish({ memoryId: `panel-memory-${String(i).padStart(3, '0')}` });
  const head = await f.repo.readHead(f.seed.head.scope), read = vi.spyOn(f.repo, 'readSource'), sourceQuery = vi.spyOn(f.repo, 'querySources');
  const page = await buildCoreView({ kind: 'memory', head }, { repo: f.repo });
  expect(page.items).toHaveLength(50); expect(page.nextCursor).toBeTruthy(); expect(read).not.toHaveBeenCalled(); expect(sourceQuery).not.toHaveBeenCalled();
  const next = await buildCoreView({ kind: 'memory', head, cursor: page.nextCursor }, { repo: f.repo }); expect(next.items).toHaveLength(1);
  const evidence = await buildCoreView({ kind: 'source', head, ref: f.batches[0]!.sourceRefs[0]! }, { repo: f.repo });
  expect(evidence.items[0]!.blocks[0]!.text).toContain('苹果'); expect(sourceQuery).toHaveBeenCalledTimes(1);
});
