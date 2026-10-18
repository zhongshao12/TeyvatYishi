// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { Core2App } from '@/components/features/Core2/Core2App';
import { createCoreController } from '@/core/settlement/coreController';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
it('creates the editable chosen traveler and companion from the real opening form, without calling a model', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: 'test-core2-opening-form-' + crypto.randomUUID() }), model = vi.fn();
  const controller = createCoreController({ repo, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: model, factModel: model, assembleContext: async () => ({ systemPrompt: '', messages: [] }) }) });
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node), initialize = vi.spyOn(controller, 'initialize');
  try {
    await act(async () => root.render(<Core2App repo={repo} controller={controller} />));
    const preset = node.querySelector('[aria-label="旅行者模板"]') as HTMLSelectElement; expect(preset).toBeTruthy();
    await act(async () => { preset.value = '荧'; preset.dispatchEvent(new Event('change', { bubbles: true })); });
    const companion = node.querySelector('[aria-label="原著旅行者同伴"]') as HTMLSelectElement;
    await act(async () => { companion.value = '空'; companion.dispatchEvent(new Event('change', { bubbles: true })); });
    const name = node.querySelector('[aria-label="旅人姓名"]') as HTMLInputElement, appearance = node.querySelector('[aria-label="外貌"]') as HTMLTextAreaElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, '新档测试者'); name.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(appearance, '玩家改过的外貌'); appearance.dispatchEvent(new Event('input', { bubbles: true })); });
    expect((node.querySelector('[aria-label="开局地区与篇章"]') as HTMLSelectElement).disabled).toBe(true);
    await act(async () => { [...node.querySelectorAll('button')].find(button => button.textContent === '建立新旅程')!.click(); await initialize.mock.results.at(-1)!.value; });
    const state = controller.getView().snapshot!;
    expect(state.records.find(row => row.domain === 'traveler')).toMatchObject({ value: { 姓名: '新档测试者', 外貌: '玩家改过的外貌' } });
    expect(state.records.filter(row => row.domain === 'npc').map(row => row.value.姓名)).toEqual(['空']);
    expect(state.records.some(row => row.domain === 'doudizhu')).toBe(true); expect(model).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); controller.dispose(); node.remove(); }
});
