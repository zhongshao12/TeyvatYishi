import { describe, expect, it } from 'vitest';
import { normalizeIrminsulMemory, type IrminsulEntry } from '@/models/teyvat/irminsul';
import { getActiveIrminsulEntries, promoteIrminsulEntry } from '@/services/irminsulPromotion';
import { retrieveIrminsulEntries } from '@/services/irminsulRetrieval';
import { upsertRecallEntry } from '@/hooks/useGame/memoryUtils';

function entry(id: string, turn: number, archiveType: IrminsulEntry['archiveType'] = 'short', patch: Partial<IrminsulEntry> = {}): IrminsulEntry {
  return { id, title: '安柏同行', summary: '安柏带领旅行者进入蒙德城', sourceText: '安柏带领旅行者进入蒙德城',
    sourceTurns: [turn], keywords: ['安柏'], recordedAt: '旅行历 1000.01.01', archiveType, turn, ...patch };
}

describe('世界树归档安全晋升', () => {
  it('promotes_only_exact_source_ids', () => {
    const source = entry('short-3', 3);
    const sameTextOtherTurn = entry('short-4', 4);
    const upper = entry('medium-3', 3, 'medium', { coveredEntryIds: ['short-3'], sourceTurns: [3] });
    const promoted = promoteIrminsulEntry({ entries: [source, sameTextOtherTurn] }, upper);
    expect(promoted.entries.map((item) => item.id)).toEqual(['short-4', 'medium-3']);
    expect(getActiveIrminsulEntries(promoted).map((item) => item.id)).toEqual(['short-4', 'medium-3']);
    expect(promoted.entries.find((item) => item.id === 'medium-3')?.sourceTurns).toEqual([3]);

    const pending = entry('pending', 3, 'medium', { status: 'pending', coveredEntryIds: ['short-3'] });
    expect(promoteIrminsulEntry({ entries: [source] }, pending).entries.map((item) => item.id))
      .toEqual(['short-3', 'pending']);
    const missingSource = entry('missing', 3, 'medium', { coveredEntryIds: ['short-3', 'absent'] });
    expect(promoteIrminsulEntry({ entries: [source] }, missingSource).entries.map((item) => item.id))
      .toEqual(['short-3', 'missing']);
    const forgedRange = entry('forged-range', 3, 'medium', { coveredEntryIds: ['short-3'], sourceTurns: [3, 99] });
    expect(promoteIrminsulEntry({ entries: [source] }, forgedRange).entries.map((item) => item.id))
      .toEqual(['short-3', 'forged-range']);
  });

  it('promotion_is_idempotent', () => {
    const source = entry('short-3', 3);
    const upper = entry('medium-3', 3, 'medium', { coveredEntryIds: ['short-3'] });
    const once = promoteIrminsulEntry({ entries: [source] }, upper);
    expect(promoteIrminsulEntry(once, upper)).toEqual(once);
    expect(retrieveIrminsulEntries({ entries: [source, entry('pending', 3, 'medium', { status: 'pending' })] }, '安柏', 5)
      .map((item) => item.id)).toEqual(['short-3']);
  });

  it('old_entries_near_limit_stay_unverified', () => {
    const old = Array.from({ length: 600 }, (_, index) => entry(`old-${index}`, index));
    const pending = entry('pending', 600, 'medium', { status: 'pending', coveredEntryIds: ['old-0'] });
    const normalized = normalizeIrminsulMemory({ entries: [...old, pending] });
    expect(normalized.entries).toHaveLength(600);
    expect(normalized.entries.some((item) => item.id === 'pending')).toBe(true);
    expect(normalized.entries.some((item) => item.id === 'old-0')).toBe(true);
    expect(normalized.entries.find((item) => item.id === 'old-1')?.coveredEntryIds).toBeUndefined();
    expect(getActiveIrminsulEntries(normalized).some((item) => item.id === 'old-0')).toBe(true);
  });

  it('does not delete another same-turn refined note without an exact covered ID', () => {
    const first = entry('refined-one', 9, 'refined', { title: '【回合纪要 一】' });
    const second = entry('refined-two', 9, 'refined', { title: '【回合纪要 二】' });
    expect(upsertRecallEntry({ entries: [first] }, second).entries.map((item) => item.id))
      .toEqual(['refined-one', 'refined-two']);
  });
});
