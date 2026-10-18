import { describe, expect, it } from 'vitest';
import { isBranchSourceReachable, type BranchPath } from '@/core/sources/branchVisibility';

const ref = { sourceId: 'source-parent', sourceVersion: 1 };
const path = (): BranchPath => ({
  scope: { journeyId: 'journey-1', branchId: 'child' },
  entries: [
    { scope: { journeyId: 'journey-1', branchId: 'child' }, cutoffSeq: 3, parent: { journeyId: 'journey-1', branchId: 'parent' }, forkSeq: 12 },
    { scope: { journeyId: 'journey-1', branchId: 'parent' }, cutoffSeq: 12 },
  ],
  sources: [{ ref, scope: { journeyId: 'journey-1', branchId: 'parent' }, commitSeq: 12, committed: true }],
});

describe('core2 source ancestry', () => {
  it('allows a confirmed parent source at the exact fork boundary', () => {
    expect(isBranchSourceReachable(ref, path())).toBe(true);
  });

  it('rejects parent future material even when it mentions only old events', () => {
    const ancestry = path();
    ancestry.sources[0]!.commitSeq = 13;
    expect(isBranchSourceReachable(ref, ancestry)).toBe(false);
  });

  it('rejects widening an ancestor cutoff beyond the actual fork', () => {
    const ancestry = path();
    ancestry.entries[1]!.cutoffSeq = 100;
    ancestry.sources[0]!.commitSeq = 13;
    expect(isBranchSourceReachable(ref, ancestry)).toBe(false);
  });

  it('rejects another journey and an unrelated sibling', () => {
    const foreign = path();
    foreign.sources[0]!.scope.journeyId = 'journey-2';
    expect(isBranchSourceReachable(ref, foreign)).toBe(false);
    const sibling = path();
    sibling.sources[0]!.scope.branchId = 'sibling';
    expect(isBranchSourceReachable(ref, sibling)).toBe(false);
  });

  it('rejects a forged sibling path entry rather than treating any listed scope as an ancestor', () => {
    const ancestry = path();
    ancestry.entries[1]!.scope.branchId = 'sibling';
    ancestry.sources[0]!.scope.branchId = 'sibling';
    expect(isBranchSourceReachable(ref, ancestry)).toBe(false);
  });

  it('rejects unknown, uncommitted, wrong-version and ambiguous source locators', () => {
    const unknown = path();
    unknown.sources = [];
    expect(isBranchSourceReachable(ref, unknown)).toBe(false);
    const pending = path();
    pending.sources[0]!.committed = false;
    expect(isBranchSourceReachable(ref, pending)).toBe(false);
    expect(isBranchSourceReachable({ ...ref, sourceVersion: 2 }, path())).toBe(false);
    const ambiguous = path();
    ambiguous.sources.push(structuredClone(ambiguous.sources[0]!));
    expect(isBranchSourceReachable(ref, ambiguous)).toBe(false);
  });

  it('respects current-branch cutoff and legitimate multi-generation ancestry', () => {
    const ancestry = path();
    ancestry.sources[0]!.scope.branchId = 'child';
    ancestry.sources[0]!.commitSeq = 4;
    expect(isBranchSourceReachable(ref, ancestry)).toBe(false);
    const grandparent = path();
    grandparent.entries[1]!.parent = { journeyId: 'journey-1', branchId: 'root' };
    grandparent.entries[1]!.forkSeq = 7;
    grandparent.entries.push({ scope: { journeyId: 'journey-1', branchId: 'root' }, cutoffSeq: 7 });
    grandparent.sources[0]!.scope.branchId = 'root';
    grandparent.sources[0]!.commitSeq = 7;
    expect(isBranchSourceReachable(ref, grandparent)).toBe(true);
  });
});
