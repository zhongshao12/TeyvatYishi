// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImagePromptLibraryPicker } from '@/components/features/ImageGeneration/ImagePromptLibraryPicker';
import { applyImagePromptSelection } from '@/utils/imagePromptLibrary';
import { createImagePromptLibraryStore } from '@/utils/imagePromptLibraryStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; host?.remove(); vi.unstubAllGlobals(); });
const button = (label: string, container: Element = host) => Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === label)!;
function input(label: string, value: string) {
  const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
async function mount(options: { failSave?: boolean; copies?: number; disabled?: boolean } = {}) {
  let saved: unknown = null;
  let fail = Boolean(options.failSave);
  const network = vi.fn(() => { throw new Error('picker must never call network'); });
  vi.stubGlobal('fetch', network);
  const store = createImagePromptLibraryStore({ load: async () => saved, save: async value => { if (fail) throw new Error('磁盘已满'); saved = structuredClone(value); } });
  function Harness() {
    const [draft, setDraft] = useState({ prompt: '安柏:棕发。要求:城门留影', negative: 'text' });
    return createElement('div', null, createElement('output', { 'aria-label': 'current-draft' }, JSON.stringify(draft)),
      ...Array.from({ length: options.copies ?? 1 }, (_, key) => createElement(ImagePromptLibraryPicker, { key, store, disabled: options.disabled,
        onApply: selection => setDraft(current => applyImagePromptSelection(current, selection)) })));
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(createElement(Harness)); });
  expect(host.querySelector('[aria-label="生图提示词库"]'), 'the shared library must expose its real controls').not.toBeNull();
  return { store, saved: () => saved, network, allowSave: () => { fail = false; } };
}

describe('shared prompt library picker', () => {
  it('searches, previews and appends either side without replacing character requirements or calling an API', async () => {
    const ui = await mount();
    await act(async () => input('搜索提示词', '清晰高质量'));
    expect(host.textContent).toContain('best quality');
    expect(host.textContent).not.toContain('dragonspine');
    await act(async () => button('追加正面').click());
    const first = host.querySelector('output')!.textContent;
    expect(first).toContain('安柏:棕发。要求:城门留影');
    expect(first).toContain('best quality');
    expect(JSON.parse(first!).negative).toBe('text');
    await act(async () => button('追加正面').click());
    expect(host.querySelector('output')!.textContent).toBe(first);
    await act(async () => button('追加负面').click());
    expect(host.querySelector('output')!.textContent).toContain('jpeg artifacts');
    expect(ui.network).not.toHaveBeenCalled();
    expect(ui.saved()).toBe(null);
  });
  it('filters by category, shows no matches honestly, and disables only generation-time editing', async () => {
    await mount({ disabled: true });
    const category = host.querySelector<HTMLSelectElement>('[aria-label="提示词分类"]')!;
    await act(async () => { category.value = '国家与地区'; category.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.textContent).toContain('蒙德');
    expect(button('追加正面').disabled).toBe(true);
    await act(async () => input('搜索提示词', '没有这样的地区'));
    expect(host.textContent).toContain('没有匹配的词组');
    expect(host.querySelector('[aria-label="词组正面预览"]')).toBe(null);
  });
  it('persists custom CRUD to the shared store and updates the other mounted picker', async () => {
    const ui = await mount({ copies: 2 });
    const libraries = host.querySelectorAll('[aria-label="生图提示词库"]');
    await act(async () => button('新增词组', libraries[0]!).click());
    await act(async () => { input('词组名称', '夜间留影'); input('自定义正面提示词', 'moonlight'); input('自定义负面提示词', 'blur'); });
    await act(async () => button('保存词组', libraries[0]!).click());
    expect(ui.store.getSnapshot().items[0]).toMatchObject({ name: '夜间留影', positive: 'moonlight', negative: 'blur' });
    expect(libraries[1]!.textContent).toContain('夜间留影');
    expect(ui.saved()).toMatchObject({ version: 1 });
    await act(async () => button('编辑词组', libraries[0]!).click());
    await act(async () => input('自定义正面提示词', 'moonlight, soft light'));
    await act(async () => button('保存词组', libraries[0]!).click());
    expect(ui.store.getSnapshot().items[0]?.positive).toBe('moonlight, soft light');
    await act(async () => button('删除词组', libraries[0]!).click());
    await act(async () => button('确认删除', libraries[0]!).click());
    expect(ui.store.getSnapshot().items).toEqual([]);
    expect(libraries[1]!.textContent).not.toContain('夜间留影');
  });
  it('keeps unsaved form values after persistence fails and reports success only after retry', async () => {
    const ui = await mount({ failSave: true });
    await act(async () => button('新增词组').click());
    await act(async () => { input('词组名称', '试作'); input('自定义正面提示词', 'soft light'); });
    await act(async () => button('保存词组').click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('磁盘已满');
    expect(host.querySelector<HTMLInputElement>('[aria-label="词组名称"]')!.value).toBe('试作');
    expect(ui.store.getSnapshot().items).toEqual([]);
    ui.allowSave(); await act(async () => button('保存词组').click());
    expect(ui.store.getSnapshot().items[0]?.name).toBe('试作');
    expect(host.textContent).toContain('已保存到本地设置');
  });
});
