// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WorldbookManagerModal } from '@/components/features/Worldbook/WorldbookManagerModal';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('worldbook durable save', () => {
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

  it('keeps the editor open when storage rejects the save', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn(async () => { throw new Error('storage unavailable'); });
    await act(async () => root.render(createElement(WorldbookManagerModal, { worldbooks: [], onSave, onClose })));
    const save = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === '保存');
    expect(save).toBeDefined();
    await act(async () => save!.click());
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
