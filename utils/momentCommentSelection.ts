/** Explicit Moments policy, independent of relationship title thresholds. */
export const MOMENT_FRIEND_AFFINITY_MIN = 100;
export const MOMENT_RANDOM_FRIEND_LIMIT = 3;
export interface MomentCommentPlan { teamNpcIds: string[]; randomNpcIds: string[] }

/** A fresh post ID carries randomness; seeded shuffling makes render/retry replay stable. */
export function selectMomentFriendIds(candidates: readonly string[], seed: string, previousIds: readonly string[] = []): string[] {
  const pool = [...new Set(candidates)].sort(); let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  const random = () => { state = (state + 0x6D2B79F5) >>> 0; let value = Math.imul(state ^ state >>> 15, state | 1); value ^= value + Math.imul(value ^ value >>> 7, value | 61); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
  for (let index = pool.length - 1; index > 0; index--) { const other = Math.floor(random() * (index + 1)); [pool[index], pool[other]] = [pool[other]!, pool[index]!]; }
  const chosen = pool.slice(0, MOMENT_RANDOM_FRIEND_LIMIT), previous = new Set(previousIds);
  if (pool.length > chosen.length && previous.size === chosen.length && chosen.every(id => previous.has(id))) chosen[chosen.length - 1] = pool[chosen.length + Math.floor(random() * (pool.length - chosen.length))]!;
  return chosen;
}
