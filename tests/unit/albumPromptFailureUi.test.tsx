// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { 创建空角色 } from '@/models/character';
import { 创建空相册系统 } from '@/models/imageGeneration';
import { 创建默认游戏设置 } from '@/models/settings';
import type { NPC记录 } from '@/models/npc';
import { chatCompletionNonStream } from '@/services/ai/chatCompletionClient';
import { readSourceImageCharacterFacts } from '@/utils/imageCharacterFacts';
vi.mock('@/services/dbService', async importOriginal => ({ ...await importOriginal<object>(), loadSetting: async () => null, saveSetting: async () => undefined }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Only the external network boundaries are replaced; prompt builders/compaction and UI are real.
vi.mock('@/services/ai/imageGeneration', () => ({
  generateImage: () => { throw new Error('image API must not run in prompt-only tests'); },
  buildNovelAIRequestPayload: () => ({}),
}));
vi.mock('@/services/ai/chatCompletionClient', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/ai/chatCompletionClient')>(),
  chatCompletionNonStream: vi.fn(async () => { throw new Error('offline'); }),
}));

const { AlbumPanel } = await import('@/components/features/GameSystems/AlbumPanel');

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let album = 创建空相册系统();
let npc: NPC记录;
let modelEnabled = false;

function button(label: string): HTMLButtonElement {
  const result = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.trim() === label);
  if (!result) throw new Error(`missing button ${label}`);
  return result;
}

function editor(rows: number): HTMLTextAreaElement {
  const result = Array.from(document.querySelectorAll('textarea')).find(item => item.rows === rows && !item.placeholder);
  if (!result) throw new Error(`missing ${rows}-row prompt editor`);
  return result;
}

function inputValue(input: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function renderPanel() {
  const settings = 创建默认游戏设置();
  settings.文生图系统.enabled = true;
  settings.文生图系统.普通接口.enabled = true;
  settings.文生图系统.enablePromptTokenizer = modelEnabled;
  await act(async () => {
    root!.render(createElement(AlbumPanel, {
      album,
      onAlbumChange: action => { album = typeof action === 'function' ? action(album) : action; },
      traveler: { ...创建空角色(), id: 'traveler', 姓名: '旅人', 性别: '女' },
      onTravelerChange: () => undefined,
      npcs: [npc], onNpcChange: () => undefined,
      gameSettings: settings, imageSettings: settings.文生图系统,
      onGameSettingsChange: () => undefined,
      apiSettings: { activeConfigId: 'test', configs: [{
        id: 'test', name: '离线测试', provider: 'openai', baseUrl: 'https://example.test/v1',
        apiKey: 'test-only', model: 'test', maxTokens: 1024, retryCount: 0, updatedAt: 1,
      }] } as never,
      nsfwEnabled: false, nsfwImageEnabled: false, mainChatHistory: [], getGameSessionId: () => 1,
    }));
  });
}

async function mount() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await renderPanel();
}

async function openTab(label: string) {
  const tab = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes(label));
  if (!tab) throw new Error(`missing tab ${label}`);
  await act(async () => { tab.click(); });
}

async function seedDraft() {
  await act(async () => { button('高级提示词编辑').click(); });
  await act(async () => {
    inputValue(editor(7), 'existing portrait draft');
    inputValue(editor(3), 'existing negative draft');
    const title = Array.from(document.querySelectorAll('label')).find(item => item.textContent?.includes('生成标题'))?.querySelector('input');
    if (title) inputValue(title, 'existing title');
  });
}

async function clickAndSettle(label: string) {
  await act(async () => {
    button(label).click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

function expectFailureDraft(label: string) {
  expect(document.body.textContent).toContain('提示词上限');
  expect(document.body.textContent).toMatch(/减少同框角色|缩短外貌摘要/);
  expect(document.body.textContent).not.toContain('正在解析');
  expect(button(label).disabled).toBe(false);
  expect(editor(7).value).toBe('existing portrait draft');
  expect(editor(3).value).toBe('existing negative draft');
  expect(album.entries).toEqual([]);
  expect(album.assets).toEqual([]);
  expect(album.tasks).toEqual([]);
}

beforeEach(() => {
  album = 创建空相册系统();
  modelEnabled = false;
  npc = {
    id: 'npc_amber', 姓名: '安柏', 性别: '女', 阶位: 'companion', 好感度: 0,
    关系: 'stranger', 亲密关系: false, 同行: true, 初见回合: 1, 最近回合: 1, 备注: [],
    外貌: 'silver hair, green eyes, '.repeat(180), 图像档案: {},
  } as NPC记录;
  const source = readSourceImageCharacterFacts(npc);
  npc.图像档案 = { englishFacts: { schemaVersion: 1, preparedAt: 1, sourceKey: JSON.stringify(source),
    anchorSourceKey: JSON.stringify({ prompt: '', negative: '' }), facts: { ...source, language: 'en', name: 'Amber', gender: 'female' } } };
  vi.mocked(chatCompletionNonStream).mockReset().mockRejectedValue(new Error('offline'));
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove();
  root = undefined;
  host = undefined;
});

describe('AlbumPanel protected fact overflow', () => {
  it('rejects a generated portrait draft after the same NPC appearance was edited', async () => {
    npc = { ...npc, 姓名: 'Amber', 性别: 'female' as never, 外貌: 'brown hair, green eyes', 图像档案: {} };
    await mount();
    const select = Array.from(document.querySelectorAll('select')).find(item => Array.from(item.options).some(option => option.value === 'npc_amber'))!;
    await act(async () => { select.value = 'npc_amber'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await clickAndSettle('生成提示词');
    expect(document.body.textContent).not.toContain('提示词生成失败');
    if (!document.querySelector('textarea[rows="7"]')) await clickAndSettle('高级提示词编辑');
    const oldPrompt = editor(7).value;
    expect(oldPrompt).toContain('brown hair');
    npc = { ...npc, 外貌: 'silver hair, blue eyes' };
    await renderPanel();
    await act(async () => { Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(item => item.textContent?.trim() === '生成').at(-1)!.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(document.body.textContent).toContain('资料已变化');
    expect(editor(7).value).toBe(oldPrompt);
    expect(album.tasks).toEqual([]);
  });
  it('shows an actionable local avatar error without discarding the existing prompt draft', async () => {
    await mount();
    const select = Array.from(document.querySelectorAll('label')).find(item => item.textContent?.includes('选择伙伴'))?.querySelector('select');
    if (!select) throw new Error('missing companion select');
    await act(async () => {
      select.value = 'npc_amber';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await seedDraft();
    await clickAndSettle('生成提示词');
    expectFailureDraft('生成提示词');
  });

  it.each([
    ['场景图', '解析场景提示词', '写清地点、天气'],
    ['故事快照', '生成快照提示词', '粘贴或选择'],
  ])('shows an actionable local %s error and restores the ready button', async (tab, label, placeholder) => {
    await mount();
    await openTab(tab);
    const source = Array.from(document.querySelectorAll('textarea')).find(item => item.placeholder.includes(placeholder));
    if (!source) throw new Error('missing source textarea');
    await act(async () => { inputValue(source, '安柏站在蒙德喷泉旁。'); });
    await seedDraft();
    await clickAndSettle(label);
    expectFailureDraft(label);
  });

  it('does not publish a model scene summary or title before compaction succeeds', async () => {
    modelEnabled = true;
    vi.mocked(chatCompletionNonStream).mockResolvedValue(JSON.stringify({
      scene: { title: 'uncommitted model title', location: 'uncommitted model location', atmosphere: 'evening',
        subject: '安柏在喷泉旁', camera: 'medium shot', avoid: '' },
      prompt: 'Mondstadt fountain, silver hair', negativePrompt: 'fog',
    }));
    await mount();
    await openTab('场景图');
    const source = Array.from(document.querySelectorAll('textarea')).find(item => item.placeholder.includes('写清地点、天气'))!;
    await act(async () => { inputValue(source, '安柏站在蒙德喷泉旁。'); });
    await seedDraft();
    await clickAndSettle('解析场景提示词');
    expectFailureDraft('解析场景提示词');
    expect(document.body.textContent).not.toContain('uncommitted model location');
    const title = Array.from(document.querySelectorAll('label')).find(item => item.textContent?.includes('生成标题'))?.querySelector('input');
    expect(title?.value).toBe('existing title');
  });
});
