// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import * as modalFocusModule from '@/components/ui/Modal';
import { SystemDrawer } from '@/components/layout/SystemDrawer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

  it('gives a real system drawer Escape handling, focus trapping, and trigger restoration', async () => {
    const host = document.createElement('div');
    const trigger = document.createElement('button');
    trigger.textContent = '打开系统面板';
    document.body.append(trigger, host);
    trigger.focus();
    const root = createRoot(host);
    let closeCount = 0;
    const renderDrawer = (open: boolean) => createElement(SystemDrawer, {
      open,
      title: '任务',
      onClose: () => { closeCount += 1; },
      children: createElement('button', { type: 'button', 'aria-label': '最后操作' }, '最后操作'),
    });

    await act(async () => { root.render(renderDrawer(true)); });
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="任务"]');
    const closeButton = document.querySelector<HTMLElement>('[aria-label="关闭面板"]');
    const lastButton = document.querySelector<HTMLElement>('[aria-label="最后操作"]');
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(closeButton);

    lastButton?.focus();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(closeButton);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(closeCount).toBe(1);

    await act(async () => { root.render(renderDrawer(false)); });
    expect(document.activeElement).toBe(trigger);
    await act(async () => { root.unmount(); });
    trigger.remove();
    host.remove();
  });
});
