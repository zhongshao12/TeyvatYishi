import { expect, it } from 'vitest';
import { rankCandidates, CORE_RECALL_RANKING_VERSION } from '@/core/retrieval/rankCandidates';
import type { RecallItem } from '@/core/retrieval/recallTypes';

it('freezes ordered structured relevance ahead of importance and recency, with stable IDs', () => {
  const rank = { entities: 0, locations: 0, terms: 0, importance: 0, recent: 0, unfinished: 0 };
  const item = (eventId: string, changes: Partial<RecallItem['rank']>): RecallItem => ({ eventId, leafIds: [eventId], sourceRefs: [], text: '同文', kind: 'event', reason: '', protected: false, rank: { ...rank, ...changes } });
  const result = rankCandidates([item('z', { entities: 1 }), item('recent', { recent: 5000 }), item('important', { importance: 100 }), item('word', { terms: 2 }), item('location', { locations: 1 }), item('a', { entities: 1 })]);
  expect(result.map(row => row.eventId)).toEqual(['a', 'z', 'location', 'word', 'important', 'recent']);
  expect(CORE_RECALL_RANKING_VERSION).toBe('structured-lexicographic-v1');
});
