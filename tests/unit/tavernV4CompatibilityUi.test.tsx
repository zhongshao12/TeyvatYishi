// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TurnItem } from '@/components/features/Chat/TurnItem';
import { TavernPresetsSettingsTab } from '@/components/features/Settings/TavernPresetsSettingsTab';
import { 创建默认游戏设置 } from '@/models/settings';
import type { STPreset } from '@/models/stTypes';
import type { 聊天消息 } from '@/models/chat';
import { 创建空角色 } from '@/models/character';
import { 创建空相册系统, type 相册系统 } from '@/models/imageGeneration';
import { extractTavernRegexScripts } from '@/hooks/useGame/tavernRegexProcessor';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const preset: STPreset = { prompts: [{ identifier: 'main', role: 'system', content: '短句' }], prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }], regex_scripts: [{ scriptName: '显示措辞', findRegex: '/旧词/g', replaceString: '新词', placement: [2], markdownOnly: true, promptOnly: false }] };

describe('preset regex UI integration', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

  it('renders the display copy but opens the original body for editing', async () => {
    const message: 聊天消息 = { id: 'a', role: 'assistant', content: '原始JSON', timestamp: 1, parsedResponse: { body: [{ kind: 'narration', text: '旧词正文' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } } };
    const before = JSON.stringify(message);
    await act(async () => root.render(createElement(TurnItem, { message, tavernPreset: preset, regexDepth: 0, onEditBody: vi.fn() })));
    expect(host.textContent).toContain('新词正文');
    const edit = [...host.querySelectorAll('button')].find(item => item.textContent?.includes('修改正文'));
    await act(async () => edit?.click());
    expect([...host.querySelectorAll('textarea')].some(item => item.value === '旧词正文')).toBe(true);
    expect(JSON.stringify(message)).toBe(before);
    expect(host.querySelector('script')).toBeNull();
  });

  it('preserves album avatar references in filtered player and narrative turns', async () => {
    const traveler = { ...创建空角色(), 姓名: '云', 头像: 'asset:compat-avatar' };
    const album: 相册系统 = { ...创建空相册系统(), assets: [{ id: 'compat-avatar', url: 'https://example.invalid/avatar.png', createdAt: 1, source: 'remote', nsfw: false, status: 'ready' }] };
    const user = { id: 'u', role: 'user', content: '旧词', timestamp: 1 } as 聊天消息;
    await act(async () => root.render(createElement(TurnItem, { message: user, traveler, album, tavernPreset: { ...preset, regex_scripts: [{ ...extractTavernRegexScripts(preset)[0]!, placement: [1, 2] }] } })));
    expect(host.textContent).toContain('新词');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://example.invalid/avatar.png');
    const assistant = { id: 'a', role: 'assistant', content: 'raw', timestamp: 2, parsedResponse: { body: [{ kind: 'dialogue', speaker: '云', text: '我说的是旧词。' }], choices: [], factCandidates: [], continuation: { summary: '', unresolved: [] } } } as 聊天消息;
    await act(async () => root.render(createElement(TurnItem, { message: assistant, traveler, album, tavernPreset: preset, previousUserInput: '我说的是新词。' })));
    expect(host.textContent).toContain('新词');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('https://example.invalid/avatar.png');
  });

  it('binds standalone rules to the selected preset draft and saves them with that preset', async () => {
    const onSave = vi.fn(async () => undefined);
    await act(async () => root.render(createElement(TavernPresetsSettingsTab, {
      settings: { ...创建默认游戏设置(), stPresetsV2: [{ id: 'p', name: '测试', preset, importedAt: 1, updatedAt: 1 }], currentStPresetIdV2: 'p', currentStCharacterId: 100001 },
      onChange: vi.fn(), onSaveImportedPreset: onSave, worldbooks: [], onWorldbooksChange: vi.fn(), apiSettings: { activeConfigId: null, configs: [] }, onApiSettingsChange: vi.fn(),
    })));
    const button = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === '导入正则包');
    expect(button).toBeDefined();
    let picker: HTMLInputElement | undefined;
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
      const element = create(tag, options);
      if (tag === 'input') picker = element as HTMLInputElement;
      return element;
    }) as typeof document.createElement);
    await act(async () => button?.click());
    const file = new File(['unused'], 'rules.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify([{ scriptName: '历史删词', findRegex: '/无用/g', replaceString: '', placement: [2], promptOnly: true }]) });
    Object.defineProperty(picker, 'files', { value: [file] });
    await act(async () => { await picker!.onchange?.call(picker!, new Event('change')); });
    expect(host.textContent).toContain('总数 2');
    const save = [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === '保存修改');
    await act(async () => save?.click());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stPresetsV2: [expect.objectContaining({ id: 'p', preset: expect.objectContaining({ regex_scripts: expect.arrayContaining([expect.objectContaining({ scriptName: '历史删词' })]) }) })] }));
  });
});
