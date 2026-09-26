// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { TavernPresetsSettingsTab } from '@/components/features/Settings/TavernPresetsSettingsTab';
import { 创建默认游戏设置 } from '@/models/settings';
import type { STPresetEntryV2 } from '@/models/stTypes';
import { getCurrentSTPresetV2 } from '@/utils/stSettingsNormalizer';
import { buildTavernMessageChain } from '@/hooks/useGame/tavernMessageChainBuilder';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const imported: STPresetEntryV2 = {
  id: 'user_same_name', name: '双人成行v10.0—青云上', importedAt: 1, updatedAt: 1,
  preset: {
    prompts: [{ identifier: 'opening', name: '正文', role: 'system', content: '玩家导入的内容' }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'opening', enabled: true }] }],
  },
};

async function renderPresets(presets: STPresetEntryV2[], currentId: string | null = null) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const props = {
    settings: { ...创建默认游戏设置(), stPresetsV2: presets, currentStPresetIdV2: currentId },
    onChange: vi.fn(),
    worldbooks: [], onWorldbooksChange: vi.fn(),
    apiSettings: { activeConfigId: null, configs: [] }, onApiSettingsChange: vi.fn(),
  } as ComponentProps<typeof TavernPresetsSettingsTab>;
  await act(async () => root.render(createElement(TavernPresetsSettingsTab, props)));
  const select = [...host.querySelectorAll('select')].find((element) =>
    [...element.options].some((option) => option.textContent === '不使用酒馆消息链'));
  expect(select).toBeDefined();
  return {
    select: select!,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe('imported Tavern preset selection', () => {
  it('shows no bundled choices when the player has not imported a preset', async () => {
    const view = await renderPresets([]);
    try {
      expect([...view.select.options].map((option) => option.value)).toEqual(['']);
    } finally {
      await view.cleanup();
    }
  });

  it('keeps an imported preset even when its display name matches a retired built-in', async () => {
    const view = await renderPresets([imported], imported.id);
    try {
      expect([...view.select.options].map((option) => option.value)).toEqual(['', imported.id]);
      expect(view.select.value).toBe(imported.id);
      expect(view.select.options[1]?.textContent).toContain(imported.name);
    } finally {
      await view.cleanup();
    }
  });

  it('builds a message chain only for a selected imported preset', () => {
    const settings: ReturnType<typeof 创建默认游戏设置> = { ...创建默认游戏设置(), stPresetsV2: [imported], currentStPresetIdV2: null };
    expect(getCurrentSTPresetV2(settings)).toBeNull();

    settings.currentStPresetIdV2 = imported.id;
    const selected = getCurrentSTPresetV2(settings);
    expect(selected).toBe(imported);
    const messages = buildTavernMessageChain({
      settings,
      preset: selected!.preset,
      characterId: null,
      chatHistory: [],
      latestUserInput: '你好',
      playerName: '旅行者',
      playerRole: null,
      includeNativeNarrative: false,
      includeNativeContextInWorldbook: false,
    });
    expect(messages.some((message) => message.content.includes('玩家导入的内容'))).toBe(true);
  });
});
