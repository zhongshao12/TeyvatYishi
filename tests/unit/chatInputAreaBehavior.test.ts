// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { InputArea } from '@/components/features/Chat/InputArea';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('InputArea behavior', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('submits a trimmed desktop draft with Enter and clears the field', async () => {
    const onSend = vi.fn();
    await act(async () => {
      root.render(createElement(InputArea, { onSend, onAbort: vi.fn(), loading: false }));
    });
    const textarea = host.querySelector('textarea')!;
    await act(async () => setTextareaValue(textarea, '  前往骑士团  '));
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onSend).toHaveBeenCalledWith('前往骑士团');
    expect(textarea.value).toBe('');
    expect(document.activeElement).toBe(textarea);
  });

  it('does not submit Enter while a Chinese IME composition is active', async () => {
    const onSend = vi.fn();
    await act(async () => {
      root.render(createElement(InputArea, { onSend, onAbort: vi.fn(), loading: false }));
    });
    const textarea = host.querySelector('textarea')!;
    await act(async () => setTextareaValue(textarea, '蒙德'));
    await act(async () => {
      textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea.value).toBe('蒙德');
  });

  it('restores a recovery draft once without overwriting a player edit', async () => {
    const props = {
      onSend: vi.fn(),
      onAbort: vi.fn(),
      loading: false,
      recoveryDraft: { workflowId: 'workflow-7', input: '恢复的草稿' },
    };
    await act(async () => root.render(createElement(InputArea, props)));
    const textarea = host.querySelector('textarea')!;
    expect(textarea.value).toBe('恢复的草稿');

    await act(async () => setTextareaValue(textarea, '玩家已修改'));
    await act(async () => root.render(createElement(InputArea, { ...props })));
    expect(textarea.value).toBe('玩家已修改');
  });
});
