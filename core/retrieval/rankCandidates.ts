import type { RecallItem } from './recallTypes';
import { compareCoreIds } from '../persistence/repositoryValidation';

/** Frozen before M09 evaluation: no tuning against held-out queries. */
export const CORE_RECALL_RANKING_VERSION = 'structured-lexicographic-v1';
export function rankCandidates(items: RecallItem[]): RecallItem[] {
  const keys = ['entities', 'locations', 'terms', 'importance', 'recent', 'unfinished'] as const;
  return [...items].sort((a, b) => {
    for (const key of keys) { const delta = b.rank[key] - a.rank[key]; if (delta) return delta; }
    // A grounded summary wins an otherwise equal event; no prose identity deduplication.
    return Number(b.kind === 'summary') - Number(a.kind === 'summary') || compareCoreIds(a.memoryId ?? a.eventId, b.memoryId ?? b.eventId);
  });
}
