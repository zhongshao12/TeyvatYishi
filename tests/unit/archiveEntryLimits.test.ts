import { describe, expect, it } from 'vitest';
import { normalizeArchiveCodex } from '@/models/teyvat/codex';
import { normalizeIrminsulMemory } from '@/models/teyvat/irminsul';

describe('long-session archive entry limits', () => {
  it('keeps only the newest 600 Irminsul entries', () => {
    const entries = Array.from({ length: 605 }, (_, index) => ({
      id: `memory-${index}`,
      turn: index,
    }));

    const normalized = normalizeIrminsulMemory({ entries });

    expect(normalized.entries).toHaveLength(600);
    expect(normalized.entries[0]?.id).toBe('memory-5');
    expect(normalized.entries.at(-1)?.id).toBe('memory-604');
  });

  it('keeps built-in codex entries and the newest custom entries within 1200 slots', () => {
    const entries = [
      { id: 'builtin-1', builtin: true, name: '内置条目' },
      ...Array.from({ length: 1205 }, (_, index) => ({ id: `custom-${index}`, name: `自定义-${index}` })),
    ];

    const normalized = normalizeArchiveCodex({ entries, unlockedEntryIds: entries.map((entry) => entry.id) });

    expect(normalized.entries).toHaveLength(1200);
    expect(normalized.entries.some((entry) => entry.id === 'builtin-1')).toBe(true);
    expect(normalized.entries.some((entry) => entry.id === 'custom-0')).toBe(false);
    expect(normalized.entries.some((entry) => entry.id === 'custom-1204')).toBe(true);
    expect(normalized.unlockedEntryIds.every((id) => normalized.entries.some((entry) => entry.id === id))).toBe(true);
  });

  it('does not overflow when built-in entries consume every codex slot', () => {
    const entries = [
      ...Array.from({ length: 1200 }, (_, index) => ({ id: `builtin-${index}`, builtin: true })),
      { id: 'custom-overflow', builtin: false },
    ];

    const normalized = normalizeArchiveCodex({ entries });

    expect(normalized.entries).toHaveLength(1200);
    expect(normalized.entries.some((entry) => entry.id === 'custom-overflow')).toBe(false);
  });
});
