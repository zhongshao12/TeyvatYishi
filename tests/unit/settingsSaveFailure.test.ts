// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SettingsModal } from '@/components/features/Settings/SettingsModal';
import { saveSetting } from '@/services/dbService';
import { pushToast } from '@/utils/toastStore';

vi.mock('@/services/dbService', () => ({ saveSetting: vi.fn() }));
vi.mock('@/utils/toastStore', () => ({ pushToast: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('settings persistence failure', () => {
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
    vi.clearAllMocks();
  });

  it('reports a rejected theme write instead of silently losing the choice', async () => {
    vi.mocked(saveSetting).mockRejectedValueOnce(new Error('disk full'));
    const onThemeChange = vi.fn();
    const props = {
      initialTab: 'theme',
      currentTheme: 'mondstadt',
      onThemeChange,
      onClose: vi.fn(),
    } as unknown as ComponentProps<typeof SettingsModal>;
    await act(async () => root.render(createElement(SettingsModal, props)));
    const liyue = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('璃月'));
    expect(liyue).toBeDefined();
    await act(async () => liyue!.click());
    expect(onThemeChange).toHaveBeenCalledWith('liyue');
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', title: '主题保存失败' }));
  });
});
