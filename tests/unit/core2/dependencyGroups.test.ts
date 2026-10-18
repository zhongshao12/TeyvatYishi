import { describe, expect, it } from 'vitest';
import { buildCoreActions } from '@/core/settlement/actions';
import { groupCoreActions } from '@/core/settlement/dependencyGroups';
import { makeCandidate, makeSeed } from './fixtures';

describe('core2 evidence-anchored action grouping', () => {
  it('deduplicates only the same source action, not two separate gifts or refreshed candidate IDs', () => {
    const seed = makeSeed();
    const a = makeCandidate({ scope: seed.head.scope, status: 'verified' });
    const duplicate = { ...structuredClone(a), candidateId: 'new-model-attempt' };
    const second = structuredClone(a); second.candidateId = 'second'; second.evidenceRefs[0]!.start = 30; second.evidenceRefs[0]!.end = 44;
    const state = { head: seed.head, records: seed.records, contentRefs: [] };
    const first = buildCoreActions({ verified: [a, duplicate, second], pending: [], rejected: [], disputed: [] }, state);
    expect(first.groups.flatMap(g => g.actions)).toHaveLength(2);
    const retry = buildCoreActions({ verified: [duplicate], pending: [], rejected: [], disputed: [] }, state);
    expect(first.groups[0]?.actions[0]?.actionId).toBe(retry.groups[0]?.actions[0]?.actionId);
  });
  it('marks a cyclic dependency or a missing dependency pending without affecting independent groups', () => {
    const seed = makeSeed();
    const candidate = makeCandidate({ scope: seed.head.scope, status: 'verified' });
    const state = { head: seed.head, records: seed.records, contentRefs: [] };
    const first = buildCoreActions({ verified: [candidate], pending: [], rejected: [], disputed: [] }, state).groups[0]!.actions[0]!;
    const second = { ...structuredClone(first), actionId: 'second', dependsOn: [first.actionId] };
    first.dependsOn = ['second'];
    expect(groupCoreActions([first, second]).every(g => g.status === 'pending')).toBe(true);
    expect(groupCoreActions([{ ...first, dependsOn: ['missing'] }])[0]?.status).toBe('pending');
  });
  it('does not allow two overlapping proposals with conflicting values to win by input order', () => {
    const seed = makeSeed(); const a = makeCandidate({ scope: seed.head.scope, status: 'verified' });
    const b = structuredClone(a); b.candidateId = 'conflict'; if (b.proposal.kind === 'inventory') b.proposal.quantity = 2;
    const result = buildCoreActions({ verified: [a, b], pending: [], rejected: [], disputed: [] }, { head: seed.head, records: seed.records, contentRefs: [] });
    expect(result.groups.every(g => g.status === 'pending')).toBe(true);
  });
});
