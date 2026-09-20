import { describe, expect, it } from 'vitest';
import * as plotPanelModule from '../../components/features/GameSystems/PlotPanel';

type DraftSyncDecision = (
  currentSegmentId: string | null,
  incomingSegmentId: string | null,
  draftDirty: boolean,
) => boolean;

function shouldReplaceDraft(
  currentSegmentId: string | null,
  incomingSegmentId: string | null,
  draftDirty: boolean,
): boolean {
  const candidate = Reflect.get(plotPanelModule, 'shouldReplaceSegmentDraft') as unknown;
  return typeof candidate === 'function'
    ? (candidate as DraftSyncDecision)(currentSegmentId, incomingSegmentId, draftDirty)
    : true;
}

describe('PlotPanel draft synchronization', () => {
  it('preserves a dirty draft when the same segment receives a background update', () => {
    expect(shouldReplaceDraft('segment-1', 'segment-1', true)).toBe(false);
  });

  it('refreshes a clean draft when the same segment changes', () => {
    expect(shouldReplaceDraft('segment-1', 'segment-1', false)).toBe(true);
  });

  it('loads the newly selected segment even when the previous draft was dirty', () => {
    expect(shouldReplaceDraft('segment-1', 'segment-2', true)).toBe(true);
  });
});
