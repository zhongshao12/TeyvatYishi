// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ToastHost } from '@/components/ui/ToastHost';
import { dismissToast, getToasts, pushToast } from '@/utils/toastStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function flushToasts() {
  for (const toast of [...getToasts()]) dismissToast(toast.id);
}

describe('toast accessibility behavior', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    flushToasts();
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function renderAndPush(input: Parameters<typeof pushToast>[0]) {
    return act(async () => {
      root.render(createElement(ToastHost));
      pushToast(input);
    });
  }

  it('announces error toasts assertively with role="alert" instead of role="status"', async () => {
    await renderAndPush({ kind: 'error', title: '自动保存失败', detail: '浏览器存储写入被拒绝。' });

    const toast = host.querySelector('[data-toast-kind="error"]');
    expect(toast).not.toBeNull();
    expect(toast?.getAttribute('role')).toBe('alert');
    expect(toast?.getAttribute('aria-live')).toBe('assertive');
    expect(host.textContent).toContain('自动保存失败');
  });

  it('keeps error toasts on screen until the user closes them', async () => {
    await renderAndPush({ kind: 'error', title: '自动保存失败', detail: '浏览器存储写入被拒绝。' });

    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });

    expect(host.querySelector('[data-toast-kind="error"]')).not.toBeNull();
    expect(getToasts()).toHaveLength(1);

    const close = host.querySelector<HTMLButtonElement>('[aria-label="关闭提示"]');
    expect(close).not.toBeNull();
    await act(async () => close!.click());
    expect(host.querySelector('[data-toast-kind="error"]')).toBeNull();
  });

  it('still auto-dismisses non-error toasts politely', async () => {
    await renderAndPush({ kind: 'info', title: '任务更新', detail: '新的委托已写入手账。' });

    const toast = host.querySelector('[data-toast-kind="info"]');
    expect(toast?.getAttribute('role')).toBe('status');
    expect(toast?.getAttribute('aria-live')).toBe('polite');

    await act(async () => {
      vi.advanceTimersByTime(4600);
    });

    expect(host.querySelector('[data-toast-kind="info"]')).toBeNull();
  });
});
