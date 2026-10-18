// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { Core2App } from '@/components/features/Core2/Core2App';
import { makeSeed } from './fixtures';
import { buildCanonicalElementTalents } from '@/data/canonicalTravelerPresets';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

it('routes map, quests and the combined element/talent page to the new controller without model calls', async () => {
  const seed = makeSeed(), player = seed.records.find(row => row.domain === 'traveler'); if (player?.domain !== 'traveler') throw Error('fixture');
  player.value.元素共鸣 = ['anemo', 'geo'].map(element => ({ element: element as 'anemo' | 'geo', source: 'traveler_resonance', mastery: 0, unlocked: true, unlockedAt: '', notes: '' }));
  player.value.主元素 = 'anemo'; player.value.天赋 = [...buildCanonicalElementTalents('anemo'), ...buildCanonicalElementTalents('geo')];
  seed.records.push({ scope: seed.head.scope, domain: 'map', entityId: 'windrise', version: 1, value: { name: '风起地', locationId: 'windrise', region: 'mondstadt', visited: true } });
  seed.records.push({ scope: seed.head.scope, domain: 'map', entityId: 'unvisited', version: 1, value: { name: '尚未探索的地点', locationId: 'unvisited', region: 'mondstadt', visited: false } });
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-journey-ui-${crypto.randomUUID()}` }), model = vi.fn();
  const controller = createCoreController({ repo, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: model, factModel: model, assembleContext: async () => ({ systemPrompt: '', messages: [] }) }) });
  await controller.initialize(seed);
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node), commands = vi.spyOn(controller, 'command');
  try {
    await act(async () => root.render(<Core2App repo={repo} controller={controller} />));
    const button = (label: string) => [...node.querySelectorAll('button')].find(row => row.textContent === label)!;
    expect(button('任务')).toBeTruthy(); expect(button('地图')).toBeTruthy(); expect(button('元素与天赋')).toBeTruthy();
    await act(async () => button('任务').click()); expect(node.textContent).toContain('问候');
    await act(async () => button('地图').click());
    expect(button('前往尚未探索的地点').disabled).toBe(true);
    await act(async () => { button('前往风起地').click(); await commands.mock.results.at(-1)!.value; });
    expect(controller.getView().snapshot!.records.find(row => row.domain === 'world')).toMatchObject({ value: { moment: { location: '风起地' } } });
    await act(async () => button('元素与天赋').click());
    expect(node.textContent).toContain('风涡剑'); expect(node.textContent).not.toContain('星陨剑');
    await act(async () => button('岩元素').click()); expect(node.textContent).toContain('星陨剑');
    await act(async () => { button('切换为岩元素').click(); await commands.mock.results.at(-1)!.value; });
    expect(controller.getView().snapshot!.records.find(row => row.domain === 'traveler')).toMatchObject({ value: { 主元素: 'geo' } });
    const level = node.querySelector('[aria-label="星陨剑等级"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(level, '2'); level.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { button('保存星陨剑等级').click(); await commands.mock.results.at(-1)!.value; });
    const traveler = controller.getView().snapshot!.records.find(row => row.domain === 'traveler');
    expect(traveler?.domain === 'traveler' && traveler.value.天赋.find(row => row.名称 === '星陨剑')?.等级).toBe(2);
    await act(async () => button('水元素').click()); expect(button('切换为水元素').disabled).toBe(true); expect(node.textContent).not.toContain('水纹剑');
    expect(model).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); controller.dispose(); node.remove(); }
});
