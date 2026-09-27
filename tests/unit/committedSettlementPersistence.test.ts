import { describe, expect, it } from 'vitest';
import type { 变量命令批次 } from '@/models/variableCommand';
import { fromLegacyVariableBatches, toLegacyVariableBatches } from '@/hooks/useGameState';
import { normalizeNarrativeRuntime } from '@/models/teyvat/runtimeSlices';
import { compactVariableBatchHistory } from '@/utils/longSessionRetention';

const batch = (id: string): 变量命令批次 => ({
  id, turn: 1, timestamp: 1, source: 'main', results: [],
  committedChanges: [{ kind: 'item', id: 'apple', name: '日落果', before: 2, after: 1 }],
});

describe('committed settlement persistence', () => {
  it('round-trips structured committed changes through the canonical save adapter', () => {
    const restored = toLegacyVariableBatches(fromLegacyVariableBatches([batch('b1')]));
    expect(restored[0]?.committedChanges).toEqual(batch('b1').committedChanges);
  });

  it('drops malformed change records on save normalization', () => {
    const normalized = normalizeNarrativeRuntime({ variableBatches: [{
      ...batch('b1'), committedChanges: [
        { kind: 'item', id: 'apple', name: '日落果', before: 2, after: 1 },
        { kind: 'secret', rawText: 'do not show' },
      ],
    }] });
    expect(normalized.variableBatches[0]?.committedChanges).toHaveLength(1);
  });

  it('drops detail when an old batch is compressed', () => {
    const history = Array.from({ length: 21 }, (_, index) => batch(`b${index}`));
    const compacted = compactVariableBatchHistory(history);
    expect(compacted[0]?.retentionSummary).toBeDefined();
    expect(compacted[0]?.committedChanges).toBeUndefined();
    expect(compacted.at(-1)?.committedChanges).toHaveLength(1);
  });
});
