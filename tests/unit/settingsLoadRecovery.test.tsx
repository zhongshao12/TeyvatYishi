// @vitest-environment jsdom
import { act, createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createRecoverableSettingsModal } from '@/components/features/Settings/RecoverableSettingsModal';
import type { SettingsModalProps } from '@/components/features/Settings/SettingsModal';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps the game mounted when settings fail, and allows close and explicit retry', async () => {
  const Ready: ComponentType<SettingsModalProps> = () => createElement('div', null, 'API 接口设置已打开');
  const loader = vi.fn()
    .mockRejectedValueOnce(new TypeError('Failed to fetch dynamically imported module: SettingsModal'))
    .mockResolvedValue({ default: Ready });
  const Settings = createRecoverableSettingsModal(loader);
  const onClose = vi.fn();
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    await act(async () => root.render(createElement('main', null,
      createElement('div', { id: 'live-game' }, '正在进行的回合'),
      createElement(Settings, { onClose } as unknown as SettingsModalProps))));
    const game = container.querySelector('#live-game');
    expect(container.textContent).toContain('设置加载失败');
    const button = (text: string) => [...container.querySelectorAll('button')].find(el => el.textContent === text)!;
    await act(async () => button('关闭并返回游戏').click());
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(2);
    await act(async () => button('重试加载设置').click());
    expect(loader).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('API 接口设置已打开');
    expect(container.querySelector('#live-game')).toBe(game);
    expect(container.textContent).not.toContain('时间线校准中断');
  } finally { await act(async () => root.unmount()); container.remove(); errors.mockRestore(); }
});
