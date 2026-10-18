// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiSettingsTab } from '@/components/features/Settings/ApiSettings';
import { SettingsPersistenceProvider } from '@/components/features/Settings/SettingsPersistence';
import { createCoreSettingsStorage } from '@/core/view/settingsStorage';
import { 创建默认游戏设置, type API设置 } from '@/models/settings';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => vi.unstubAllGlobals());
it('adds a selectable local 128k profile without replacing or activating over the current main API, persists it, and uses the compatible chat endpoint', async () => {
  const original = { id: 'original-main', name: '原有接口', provider: 'openai_compatible' as const, baseUrl: 'https://example.invalid/v1', apiKey: 'fixture-not-a-key', model: 'original-model', createdAt: 1, updatedAt: 1 };
  let latest: API设置 = { activeConfigId: original.id, configs: [original] };
  const storage = createCoreSettingsStorage({ factory: new IDBFactory(), desktop: false });
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { messages: { role: string; content: string }[] };
    requests.push({ url: String(url), body });
    const challenge = body.messages.find(row => row.role === 'user')?.content.match(/KT-[0-9A-F]{8}/u)?.[0];
    return Response.json({ choices: [{ message: { content: challenge ?? 'missing challenge' } }] });
  }));
  function Harness() {
    const [api, setApi] = useState(latest), [game, setGame] = useState(创建默认游戏设置()); latest = api;
    return <SettingsPersistenceProvider value={storage}><ApiSettingsTab settings={api} onChange={setApi} gameSettings={game} onGameSettingsChange={setGame} /></SettingsPersistenceProvider>;
  }
  const button = (name: string) => [...node.querySelectorAll('button')].find(row => row.textContent?.trim() === name);
  try {
    await act(async () => root.render(<Harness />));
    expect(button('添加本地 Gemma4 · 128k')).toBeTruthy();
    await act(async () => button('添加本地 Gemma4 · 128k')!.click());
    expect(latest.activeConfigId).toBe('original-main'); expect(latest.configs[0]).toEqual(original);
    expect(latest.configs).toHaveLength(2);
    const local = latest.configs[1]!;
    expect(local).toMatchObject({ provider: 'openai_compatible', name: '本地 Gemma4 · 128k', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'ollama', model: 'gemma4-heretic-128k:latest', temperature: 0.9, topP: 0.95, maxContext: 131072, maxTokens: 8192 });
    await act(async () => button('添加本地 Gemma4 · 128k')!.click());
    expect(latest.configs).toHaveLength(2); expect(latest.configs[1]).toEqual(local);
    expect(requests).toEqual([]);
    const thinking = node.querySelector<HTMLSelectElement>('select[aria-label="本地模型思考模式"]'); expect(thinking).toBeTruthy();
    expect(thinking!.value).toBe('default');
    await act(async () => { thinking!.value = 'off'; thinking!.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { button('测试连接')!.click(); });
    await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); expect(node.textContent).toContain('连接成功'); });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('/api/local-ollama/v1/chat/completions');
    expect(requests[0]!.body).toMatchObject({ model: 'gemma4-heretic-128k:latest', top_p: 0.95, max_tokens: 32, reasoning_effort: 'none' });
    expect(requests[0]!.body).not.toHaveProperty('num_ctx');
    expect(latest.activeConfigId).toBe('original-main');
    const save = [...node.querySelectorAll('button')].find(row => row.textContent?.replace(/\s/gu, '').includes('保存配置'))!;
    await act(async () => { save.click(); await vi.waitFor(async () => expect(await storage.loadSetting('apiSettings')).toEqual(latest)); });
    expect(latest.configs[1]).toHaveProperty('ollamaThinking', false);
    expect(latest.configs[0]).toEqual(original);
    await act(async () => { thinking!.value = 'on'; thinking!.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { thinking!.value = 'default'; thinking!.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { save.click(); await vi.waitFor(async () => expect(await storage.loadSetting('apiSettings')).toEqual(latest)); });
    expect(latest.configs[1]).not.toHaveProperty('ollamaThinking');
  } finally { await act(async () => root.unmount()); node.remove(); }
});
