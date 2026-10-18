// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { Core2App } from '@/components/features/Core2/Core2App';
import { makeSeed } from './fixtures';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
it('opens the actual journey selector, selects a same-name journey and cancels a new opening without deleting the current one', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-directory-ui-${crypto.randomUUID()}` }), a = makeSeed(), b = makeSeed(), model = vi.fn();
  const controller = createCoreController({ repo, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: model, factModel: model, assembleContext: async () => ({ systemPrompt: '', messages: [] }) }) });
  await controller.initialize(a); await controller.initialize(b);
  const el = document.createElement('div'); document.body.append(el); const root = createRoot(el);
  try {
    await act(async () => root.render(<Core2App repo={repo} controller={controller} />));
    const button = (text: string) => [...el.querySelectorAll('button')].find(row => row.textContent === text)!;
    expect(button('选择旅程')).toBeTruthy(); await act(async () => button('选择旅程').click());
    for (let i = 0; i < 100 && !el.querySelector('[data-journey-id]'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    const choices = [...el.querySelectorAll<HTMLButtonElement>('[data-journey-id]')]; expect(choices).toHaveLength(2);
    expect(new Set(choices.map(row => row.textContent)).size).toBe(2);
    await act(async () => choices.find(row => row.dataset.journeyId === a.head.scope.journeyId)!.click());
    for (let i = 0; i < 100 && controller.getView().snapshot?.head.scope.journeyId !== a.head.scope.journeyId; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(controller.getView().snapshot!.head.scope).toEqual(a.head.scope);
    await act(async () => button('开始新旅程').click()); expect(el.querySelector('[aria-label="旅人姓名"]')).toBeTruthy();
    await act(async () => button('取消新建').click()); expect(el.querySelector('[aria-label="旅人姓名"]')).toBeNull();
    expect(controller.getView().snapshot!.head.scope).toEqual(a.head.scope); expect((await repo.queryJourneys({})).items).toHaveLength(2); expect(model).not.toHaveBeenCalled();
    await act(async () => button('开始新旅程').click());
    const name = el.querySelector('[aria-label="旅人姓名"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, '云'); name.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => button('建立新旅程').click());
    for (let i = 0; i < 100 && (!controller.getView().snapshot || controller.getView().snapshot?.head.scope.journeyId === a.head.scope.journeyId); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(controller.getView().snapshot!.head.scope.journeyId).not.toBe(a.head.scope.journeyId); expect((await repo.queryJourneys({})).items).toHaveLength(3);
  } finally { await act(async () => root.unmount()); controller.dispose(); el.remove(); }
});
