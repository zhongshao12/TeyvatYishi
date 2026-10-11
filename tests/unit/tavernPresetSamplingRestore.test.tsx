// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { TavernPresetsSettingsTab } from '@/components/features/Settings/TavernPresetsSettingsTab';
import { 创建默认游戏设置, type API设置 } from '@/models/settings';
import type { STPresetEntryV2 } from '@/models/stTypes';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Tavern preset sampling restore', () => {
  it('fully restores unset fields after repeated partial preset switches, even with a JSON-serialized backup', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const presets: STPresetEntryV2[] = [
      { id: 'first', name: 'first', importedAt: 1, updatedAt: 1, preset: { temperature: 0.2, top_p: 0.4, max_context: 99999, prompts: [], prompt_order: [] } },
      { id: 'second', name: 'second', importedAt: 1, updatedAt: 1, preset: { top_p: 0.7, prompts: [], prompt_order: [] } },
    ];
    const original: API设置 = { activeConfigId: 'main', configs: [{ id: 'main', name: 'main', provider: 'openai',
      baseUrl: 'https://example.invalid/v1', apiKey: 'test-key', model: 'test-model', temperature: 0.8, frequencyPenalty: 0,
      maxTokens: 3000, createdAt: 1, updatedAt: 1 }] };
    let latestApi = original;
    let latestSettings = { ...创建默认游戏设置(), stPresetsV2: presets, currentStPresetIdV2: null as string | null };
    function Harness() {
      const [settings, setSettings] = useState(latestSettings);
      const [apiSettings, setApiSettings] = useState(original);
      return createElement(TavernPresetsSettingsTab, { settings,
        onChange: (next) => { latestSettings = JSON.parse(JSON.stringify(next)); setSettings(latestSettings); },
        apiSettings, onApiSettingsChange: (next) => { latestApi = next; setApiSettings(next); },
        worldbooks: [], onWorldbooksChange: () => {},
      });
    }
    const switchTo = async (id: string) => {
      const select = [...host.querySelectorAll('select')].find((element) => [...element.options].some((option) => option.textContent === '不使用酒馆消息链'));
      expect(select).toBeDefined();
      await act(async () => { select!.value = id; select!.dispatchEvent(new Event('change', { bubbles: true })); });
    };
    try {
      await act(async () => root.render(createElement(Harness)));
      await switchTo('first');
      expect(latestApi.configs[0]).toMatchObject({ temperature: 0.2, topP: 0.4, maxContext: 99999, frequencyPenalty: 0, maxTokens: 3000 });
      await switchTo('second');
      expect(latestApi.configs[0]?.topP).toBe(0.7);
      await switchTo('');
      expect(latestApi.configs[0]?.temperature).toBe(0.8);
      expect(latestApi.configs[0]?.topP).toBeUndefined();
      expect(latestApi.configs[0]?.maxContext).toBeUndefined();
      expect(latestApi.configs[0]?.frequencyPenalty).toBe(0);
      expect(latestApi.configs[0]?.maxTokens).toBe(3000);
      expect(latestSettings.stPresetApiBackup).toBeNull();
      await switchTo('first');
      await switchTo('');
      expect(JSON.parse(JSON.stringify(latestApi))).toEqual(original);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
