// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { 创建默认游戏设置, type API设置 } from '@/models/settings';
import type { STPresetEntryV2 } from '@/models/stTypes';
import { TavernPresetsSettingsTab } from '@/components/features/Settings/TavernPresetsSettingsTab';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const imported: STPresetEntryV2 = {
  id: 'imported_amber', name: '安柏预设', importedAt: 1, updatedAt: 1,
  preset: {
    prompts: [{ identifier: 'main', name: '正文', role: 'system', content: '原始正文' }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
  },
};
const apiSettings: API设置 = { activeConfigId: null, configs: [] };
const makeSettings = () => ({
  ...创建默认游戏设置(),
  stPresets: [],
  currentStPresetId: null,
  stPresetsV2: [imported],
  currentStPresetIdV2: imported.id,
  currentStCharacterId: 100001,
});

async function editContent(host: HTMLElement, content: string) {
  const editor = [...host.querySelectorAll('textarea')].find((item) => item.value === '原始正文');
  expect(editor).toBeDefined();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(editor, content);
    editor?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('imported Tavern preset editing', () => {
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

  it('holds edits as a draft until Save is clicked', async () => {
    const onChange = vi.fn();
    const onSaveImportedPreset = vi.fn(async () => undefined);
    const settings = makeSettings();
    const props = {
      settings, onChange, onSaveImportedPreset,
      worldbooks: [], onWorldbooksChange: vi.fn(),
      apiSettings, onApiSettingsChange: vi.fn(),
    } as ComponentProps<typeof TavernPresetsSettingsTab>;
    await act(async () => root.render(createElement(TavernPresetsSettingsTab, props)));
    onChange.mockClear();

    await editContent(host, '修改后的正文');

    expect(onChange).not.toHaveBeenCalled();
    expect(onSaveImportedPreset).not.toHaveBeenCalled();
    const saveButton = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === '保存修改');
    expect(saveButton).toBeDefined();
    await act(async () => saveButton?.click());
    expect(onSaveImportedPreset).toHaveBeenCalledWith(expect.objectContaining({
      stPresetsV2: [expect.objectContaining({
        id: imported.id,
        preset: expect.objectContaining({ prompts: [expect.objectContaining({ content: '修改后的正文' })] }),
      })],
    }));
  });

  it('keeps the draft after a failed save and asks before switching presets', async () => {
    const onChange = vi.fn();
    const onSaveImportedPreset = vi.fn(async () => { throw new Error('storage unavailable'); });
    await act(async () => root.render(createElement(TavernPresetsSettingsTab, {
      settings: makeSettings(), onChange, onSaveImportedPreset,
      worldbooks: [], onWorldbooksChange: vi.fn(),
      apiSettings, onApiSettingsChange: vi.fn(),
    })));
    onChange.mockClear();
    await editContent(host, '尚未保存');

    const saveButton = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === '保存修改');
    await act(async () => saveButton?.click());
    expect(onSaveImportedPreset).toHaveBeenCalledOnce();
    expect(saveButton?.hasAttribute('disabled')).toBe(false);
    expect([...host.querySelectorAll('textarea')].some((item) => item.value === '尚未保存')).toBe(true);

    const presetSelect = [...host.querySelectorAll('select')].find((item) => item.value === imported.id);
    expect(presetSelect).toBeDefined();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(presetSelect, '');
      presetSelect?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.querySelector('[role="dialog"][aria-label="未保存修改"]')).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    const cancel = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === '取消');
    await act(async () => cancel?.click());
    expect(onChange).not.toHaveBeenCalled();
    expect([...host.querySelectorAll('textarea')].some((item) => item.value === '尚未保存')).toBe(true);
  });
});
