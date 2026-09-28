import type { NPC记录 } from '@/models/npc';

/** Hide a character from active rosters and prompt selection without deleting history. */
export function archiveNpc(record: NPC记录): NPC记录 {
  if (record.已归档) return record;
  return { ...record, 已归档: true, 归档前阶位: record.阶位, 阶位: 'extra', 同行: false };
}

/** Return a character to the roster, but never silently rejoin the party. */
export function restoreNpc(record: NPC记录): NPC记录 {
  if (!record.已归档) return record;
  const { 已归档: _archived, 归档前阶位: previousTier, ...rest } = record;
  return { ...rest, 阶位: previousTier ?? 'extra', 同行: false };
}
