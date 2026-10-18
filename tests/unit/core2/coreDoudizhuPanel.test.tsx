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
it('opens without writes, invites two companions, plays a local turn and confirms abandonment through registered commands', async () => {
  const seed = makeSeed(), amber = seed.records.find(row => row.domain === 'npc'); if (amber?.domain !== 'npc') throw Error('fixture');
  seed.records.push({ ...structuredClone(amber), entityId: 'npc-lisa', value: { ...structuredClone(amber.value), id: 'npc-lisa', 姓名: '丽莎' } });
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-doudizhu-ui-${crypto.randomUUID()}` }), model = vi.fn();
  const controller = createCoreController({ repo, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: model, factModel: model, assembleContext: async () => ({ systemPrompt: '', messages: [] }) }) });
  await controller.initialize(seed);
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node), commands = vi.spyOn(controller, 'command');
  const button = (name: string) => [...node.querySelectorAll('button')].find(row => row.textContent === name)!;
  try {
    await act(async () => root.render(<Core2App repo={repo} controller={controller} />)); expect(button('斗地主')).toBeTruthy();
    await act(async () => button('斗地主').click()); expect(commands).not.toHaveBeenCalled();
    for (const [label, id] of [['第一位同伴', 'npc-amber'], ['第二位同伴', 'npc-lisa']]) {
      const select = node.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement;
      await act(async () => { select.value = id!; select.dispatchEvent(new Event('change', { bubbles: true })); });
    }
    await act(async () => { button('开始新局').click(); await commands.mock.results.at(-1)!.value; });
    expect(node.querySelectorAll('[data-card-id]')).toHaveLength(17);
    await act(async () => { button('叫3分').click(); await commands.mock.results.at(-1)!.value; });
    expect(node.textContent).toContain('地主');
    await act(async () => button('退出牌局').click()); expect(button('确认退出，不计奖励')).toBeTruthy();
    await act(async () => { button('确认退出，不计奖励').click(); await commands.mock.results.at(-1)!.value; });
    expect(controller.getView().snapshot!.records.find(row => row.domain === 'doudizhu')).toMatchObject({ value: { currentGame: null } });
    expect(model).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); controller.dispose(); node.remove(); }
});
