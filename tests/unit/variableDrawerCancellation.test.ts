// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VariableDrawer } from '@/components/features/Variable/VariableDrawer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('workflow queue cancellation', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('labels the shared abort as stopping the whole turn', async () => {
    const onCancelTask = vi.fn();
    await act(async () => root.render(createElement(VariableDrawer, {
      batches: [],
      tasks: [{ id: 'steambird', title: '蒸汽鸟报', turn: 2, timestamp: 1, status: 'pending', cancellable: true }],
      onCancelTask,
    })));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-controls="variable-drawer-panel"]')!.click());

    const stop = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === '停止本回合');
    expect(stop).toBeDefined();
    await act(async () => stop!.click());
    expect(onCancelTask).toHaveBeenCalledWith('steambird');
  });
});
