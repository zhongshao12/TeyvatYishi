// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { ApiSettingsTab } from '@/components/features/Settings/ApiSettings';
import { SettingsPersistenceProvider } from '@/components/features/Settings/SettingsPersistence';
import { createCoreSettingsStorage } from '@/core/view/settingsStorage';
import { 创建默认游戏设置, type API设置 } from '@/models/settings';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

it('applies a saved API package through one awaited settings transaction, preserving independent routes on reload', async () => {
  const factory = new IDBFactory(), storage = createCoreSettingsStorage({ factory, desktop: false });
  const game = 创建默认游戏设置();
  const api: API设置 = { activeConfigId: 'fixture', configs: [{ id: 'fixture', name: '隔离方案', provider: 'openai_compatible', baseUrl: 'https://fixture.invalid/v1', apiKey: 'fixture-not-secret', model: 'fixture', createdAt: 1, updatedAt: 1 }] };
  const profile = { app: 'KaiTuoYiShi', kind: 'api-profile', version: 1, exportedAt: '2026-10-17T00:00:00Z', includeApiKeys: true, apiSettings: api, enableClaudeMode: true,
    routes: { variableApi: { ...game.variableApi, model: 'variable-fixture' }, 蒸汽鸟报系统: game.蒸汽鸟报系统.api, 手机系统: { ...game.手机系统.api, model: 'phone-fixture' }, 图鉴系统: game.图鉴系统.api, 剧情编织系统: game.剧情编织系统.api,
      记忆总结API: game.记忆系统.记忆总结API, 世界树召回API: game.记忆系统.世界树召回API, 世界树归档API: game.记忆系统.世界树归档API,
      文生图普通接口: game.文生图系统.普通接口, 文生图NSFW接口: game.文生图系统.NSFW接口, 文生图词组转化器API: game.文生图系统.词组转化器API } };
  await storage.saveSetting('apiProfileSlots', [{ id: 'slot', name: '完整方案', savedAt: 1, profile }]);
  const persist = vi.spyOn(storage, 'saveSettings');
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  function Harness() { const [settings, setSettings] = useState(api), [current, setCurrent] = useState(game);
    return <SettingsPersistenceProvider value={storage}><ApiSettingsTab settings={settings} onChange={setSettings} gameSettings={current} onGameSettingsChange={setCurrent} /></SettingsPersistenceProvider>; }
  try {
    await act(async () => root.render(<Harness />));
    for (let attempt = 0; attempt < 100 && ![...container.querySelectorAll('button')].some(button => button.textContent?.trim() === '读取'); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === '读取')!.click(); });
    for (let attempt = 0; attempt < 100 && !container.textContent?.includes('已切换到 API 方案：完整方案'); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(container.textContent).toContain('已切换到 API 方案：完整方案');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(Object.keys(persist.mock.calls[0]![0]).sort()).toEqual(['apiSettings', 'gameSettings']);
    const reloaded = createCoreSettingsStorage({ factory, desktop: false });
    expect(await reloaded.loadSetting('apiSettings')).toMatchObject({ configs: [expect.objectContaining({ model: 'fixture', apiKey: 'fixture-not-secret' })] });
    expect(await reloaded.loadSetting('gameSettings')).toMatchObject({ enableClaudeMode: true, variableApi: { model: 'variable-fixture' }, 手机系统: { api: { model: 'phone-fixture' } } });
    expect((await factory.databases()).map(row => row.name)).toEqual(['TeyvatCore2SettingsDB']);
  } finally { await act(async () => root.unmount()); container.remove(); }
});
