// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatBookmarksPanel } from '@/components/features/Chat/ChatBookmarksPanel';
import { SlotPickerModal, ImagePreviewModal } from '@/components/features/GameSystems/album/workspaces';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('top-level dialog accessibility', () => {
  let host: HTMLDivElement;
  let root: Root;
  let trigger: HTMLButtonElement;

  beforeEach(() => {
    trigger = document.createElement('button');
    trigger.textContent = '打开弹窗';
    host = document.createElement('div');
    document.body.append(trigger, host);
    trigger.focus();
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    trigger.remove();
    vi.restoreAllMocks();
  });

  it('gives the bookmark panel Escape handling, a focus trap, and focus restoration', async () => {
    const onClose = vi.fn();
    const render = (open: boolean) => createElement(
      'div',
      null,
      open
        ? createElement(ChatBookmarksPanel, {
          bookmarks: [{ messageId: 'm1', title: '第一章', note: '备注', turn: 3, createdAt: 1 }],
          onSelect: vi.fn(),
          onClose,
        })
        : null,
    );

    await act(async () => { root.render(render(true)); });

    const dialog = host.querySelector<HTMLElement>('[role="dialog"][aria-label="剧情书签"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    // 初始焦点必须进入弹窗内部，而不是留在触发按钮上。
    expect(dialog?.contains(document.activeElement)).toBe(true);

    // Tab 在最后一个可聚焦元素上必须回到第一个（焦点圈定）。
    const focusables = Array.from(dialog!.querySelectorAll<HTMLElement>('button'));
    expect(focusables.length).toBeGreaterThan(1);
    focusables[focusables.length - 1]!.focus();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    expect(document.activeElement).toBe(focusables[0]);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => { root.render(render(false)); });
    expect(document.activeElement).toBe(trigger);
  });

  it('gives the album slot picker Escape handling with focus restoration', async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(createElement(SlotPickerModal, {
        open: true,
        recordName: '安柏',
        entryTitle: '立绘',
        onClose,
        onSelect: vi.fn(),
      }));
    });

    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="设置到槽位"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.contains(document.activeElement)).toBe(true);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(createElement(SlotPickerModal, {
        open: false,
        recordName: '安柏',
        entryTitle: '立绘',
        onClose,
        onSelect: vi.fn(),
      }));
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('gives the image preview overlay Escape handling with focus restoration', async () => {
    const onClose = vi.fn();
    await act(async () => {
      root.render(createElement(ImagePreviewModal, { open: true, src: 'blob:preview', title: '立绘预览', onClose }));
    });

    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="立绘预览"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.contains(document.activeElement)).toBe(true);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(createElement(ImagePreviewModal, { open: false, src: 'blob:preview', title: '立绘预览', onClose }));
    });
    expect(document.activeElement).toBe(trigger);
  });
});
