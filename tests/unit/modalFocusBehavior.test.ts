import { describe, expect, it } from 'vitest';
import * as modalFocusModule from '@/components/ui/Modal';

type FocusCandidate = { id: string; visible: boolean; connected?: boolean };
type ModalFocusApi = {
  filterVisibleFocusCandidates<T>(candidates: readonly T[], isVisible: (candidate: T) => boolean): T[];
  resolveTabFocusTarget<T>(candidates: readonly T[], active: T | null, shiftKey: boolean, containsActive: boolean): T | null;
  resolveFocusRestoreTarget<T>(previous: T | null, remainingModal: T | null, isConnected: (candidate: T) => boolean, remainingContainsPrevious: boolean): T | null;
};

const api = modalFocusModule as unknown as Partial<ModalFocusApi>;

describe('Modal focus behavior', () => {
  it('places initial focus on the first visible candidate when the first DOM match is hidden', () => {
    expect(typeof api.filterVisibleFocusCandidates).toBe('function');
    const candidates: FocusCandidate[] = [
      { id: 'hidden-first', visible: false },
      { id: 'visible-first', visible: true },
      { id: 'visible-last', visible: true },
    ];

    const visible = api.filterVisibleFocusCandidates!(candidates, (candidate) => candidate.visible);

    expect(visible.map((candidate) => candidate.id)).toEqual(['visible-first', 'visible-last']);
    expect(visible[0]?.id).toBe('visible-first');
  });

  it('pulls an external active element into the first or last focus target based on Tab direction', () => {
    expect(typeof api.resolveTabFocusTarget).toBe('function');
    const first = { id: 'first', visible: true };
    const last = { id: 'last', visible: true };
    const outside = { id: 'outside', visible: true };

    expect(api.resolveTabFocusTarget!([first, last], outside, false, false)).toBe(first);
    expect(api.resolveTabFocusTarget!([first, last], outside, true, false)).toBe(last);
  });

  it('restores the connected trigger after the final modal closes', () => {
    expect(typeof api.resolveFocusRestoreTarget).toBe('function');
    const trigger = { id: 'settings-trigger', visible: true, connected: true };

    expect(api.resolveFocusRestoreTarget!(trigger, null, (candidate) => candidate.connected === true, false)).toBe(trigger);
  });
});
