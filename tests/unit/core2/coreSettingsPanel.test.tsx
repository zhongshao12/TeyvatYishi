// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import * as settingsUi from '@/components/features/Core2/CoreSettingsPanel';
import { createCoreSettingsStorage } from '@/core/view/settingsStorage';
import { 创建默认游戏设置, 创建空API设置 } from '@/models/settings';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

it('reuses the full image settings editor but saves only into the Core2 configuration boundary', async () => {
  expect(typeof settingsUi.CoreSettingsPanel).toBe('function');
  const factory = new IDBFactory(), storage = createCoreSettingsStorage({ factory, desktop: false }), apply = vi.fn();
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  try {
    await act(async () => root.render(<settingsUi.CoreSettingsPanel settings={创建默认游戏设置()} api={创建空API设置()} worldbooks={[]} storage={storage} onApply={apply} />));
    expect(await factory.databases()).toEqual([]);
    await act(async () => { [...node.querySelectorAll('button')].find(button => button.textContent === '设置')!.click(); await import('@/components/features/Settings/ApiSettings'); });
    await act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent === '生图设置')!.click(); await import('@/components/features/Settings/ImageGenerationSettingsTab'); });
    expect([...document.querySelectorAll('button')].some(button => button.textContent?.includes('保存文生图设置'))).toBe(true);
    await act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent?.includes('保存文生图设置'))!.click(); await vi.waitFor(() => expect(apply).toHaveBeenCalled()); });
    expect(await storage.loadSetting('gameSettings')).toMatchObject({ 文生图系统: 创建默认游戏设置().文生图系统 });
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ gameSettings: expect.any(Object) }));
    expect((await factory.databases()).map(db => db.name)).toEqual(['TeyvatCore2SettingsDB']);
  } finally { await act(async () => root.unmount()); node.remove(); }
});
