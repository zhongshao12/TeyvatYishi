// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SettingsModal } from '@/components/features/Settings/SettingsModal';
import { saveSetting } from '@/services/dbService';
import { pushToast } from '@/utils/toastStore';
import { 创建默认游戏设置 } from '@/models/settings';

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

  it('warns about an unsaved imported Tavern preset before closing settings', async () => {
    const onClose = vi.fn();
    const props = {
      initialTab: 'tavernPresets', onClose,
      gameSettings: {
        ...创建默认游戏设置(),
        stPresets: [], currentStPresetId: null,
        stPresetsV2: [{
          id: 'imported_amber', name: '安柏预设', importedAt: 1, updatedAt: 1,
          preset: {
            prompts: [{ identifier: 'main', name: '正文', role: 'system', content: '原始正文' }],
            prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
          },
        }],
        currentStPresetIdV2: 'imported_amber', currentStCharacterId: 100001,
      },
      onGameSettingsChange: vi.fn(),
      apiSettings: { activeConfigId: null, configs: [] },
      worldbooks: [], onWorldbooksChange: vi.fn(),
    } as unknown as ComponentProps<typeof SettingsModal>;
    await act(async () => root.render(createElement(SettingsModal, props)));
    const editor = [...host.querySelectorAll('textarea')].find((item) => item.value === '原始正文');
    expect(editor).toBeDefined();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(editor, '草稿内容');
      editor?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const close = host.querySelector<HTMLButtonElement>('button[aria-label="关闭"]');
    await act(async () => close?.click());
    expect(onClose).not.toHaveBeenCalled();
    expect(host.querySelector('[role="dialog"][aria-label="未保存修改"]')).not.toBeNull();
    const cancel = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === '取消');
    await act(async () => cancel?.click());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('persists an imported Tavern draft before applying it to live settings', async () => {
    vi.mocked(saveSetting).mockResolvedValue(undefined);
    const onGameSettingsChange = vi.fn();
    const props = {
      initialTab: 'tavernPresets', onClose: vi.fn(),
      gameSettings: {
        ...创建默认游戏设置(), stPresets: [], currentStPresetId: null,
        stPresetsV2: [{
          id: 'imported_amber', name: '安柏预设', importedAt: 1, updatedAt: 1,
          preset: {
            prompts: [{ identifier: 'main', name: '正文', role: 'system', content: '原始正文' }],
            prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
          },
        }],
        currentStPresetIdV2: 'imported_amber', currentStCharacterId: 100001,
      },
      onGameSettingsChange,
      apiSettings: { activeConfigId: null, configs: [] },
      worldbooks: [], onWorldbooksChange: vi.fn(),
    } as unknown as ComponentProps<typeof SettingsModal>;
    await act(async () => root.render(createElement(SettingsModal, props)));
    vi.mocked(saveSetting).mockClear();
    onGameSettingsChange.mockClear();
    const editor = [...host.querySelectorAll('textarea')].find((item) => item.value === '原始正文');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(editor, '已保存正文');
      editor?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(saveSetting).not.toHaveBeenCalled();
    expect(onGameSettingsChange).not.toHaveBeenCalled();
    const save = [...host.querySelectorAll('button')].find((button) => button.textContent?.trim() === '保存修改');
    await act(async () => save?.click());
    expect(saveSetting).toHaveBeenCalledWith('gameSettings', expect.objectContaining({
      stPresetsV2: [expect.objectContaining({
        preset: expect.objectContaining({ prompts: [expect.objectContaining({ content: '已保存正文' })] }),
      })],
    }));
    expect(onGameSettingsChange).toHaveBeenCalledOnce();
  });
});
