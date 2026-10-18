// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { createCoreStoryResources } from '@/core/content/storyCatalog';
import { attachCoreStoryResources } from '@/core/content/storyContext';
import { Core2App } from '@/components/features/Core2/Core2App';
import { makeSeed } from './fixtures';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

it('loads story content only on demand and displays an explicitly selected chapter without completing it', async () => {
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-story-ui-${crypto.randomUUID()}` }), seed = makeSeed();
  const load = vi.fn(async () => ({ id: 'mondstadt-story', 标题: '蒙德序章', 分段列表: [{ id: 'mondstadt-start', 标题: '风中的骑士', 本段概括: '在蒙德结识伙伴。', 场景节点: [
    { id: 'meet-amber', 标题: '与安柏相逢', 地点: '低语森林', 目标: '认识安柏', 完成证据: ['明确互相介绍'] },
    { id: 'enter-mondstadt', 标题: '抵达蒙德城', 地点: '蒙德城门', 目标: '一起进入城门', 完成证据: ['明确到达城内'] },
  ] }] }));
  const resources = createCoreStoryResources(['mondstadt-story'], load), model = vi.fn();
  const controller = createCoreController({ repo, storyResources: resources, turnDependencies: () => attachCoreStoryResources({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: model, factModel: model, assembleContext: async () => ({ systemPrompt: '', messages: [] }) }, resources) });
  await controller.initialize(seed);
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  try {
    await act(async () => root.render(<Core2App repo={repo} controller={controller} />)); expect(load).not.toHaveBeenCalled();
    const button = (text: string) => [...node.querySelectorAll('button')].find(row => row.textContent === text)!;
    expect(button('剧情')).toBeTruthy(); await act(async () => button('剧情').click());
    for (let i = 0; i < 100 && !node.textContent?.includes('抵达蒙德城'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    const select = node.querySelector('[aria-label="选择剧情节点"]') as HTMLSelectElement;
    await act(async () => { select.value = 'enter-mondstadt'; select.dispatchEvent(new Event('change', { bubbles: true })); button('调整到此节点').click(); });
    expect(button('确认调整剧情')).toBeTruthy();
    await act(async () => button('确认调整剧情').click());
    for (let i = 0; i < 100 && !node.textContent?.includes('当前篇章：蒙德序章 · 风中的骑士 · 抵达蒙德城'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(node.textContent).toContain('当前篇章：蒙德序章 · 风中的骑士 · 抵达蒙德城');
    expect(controller.getView().snapshot!.records.find(row => row.domain === 'story')).toMatchObject({ value: { nodeId: 'enter-mondstadt', status: 'progressing', completedNodeIds: [] } });
    expect(model).not.toHaveBeenCalled(); expect(load).toHaveBeenCalledTimes(1);
    await act(async () => button('编辑剧情资料').click());
    const field = node.querySelector('[aria-label="剧情资料字段"]') as HTMLSelectElement;
    await act(async () => { field.value = 'goal'; field.dispatchEvent(new Event('change', { bubbles: true })); });
    const text = node.querySelector('[aria-label="剧情资料内容"]') as HTMLTextAreaElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(text, '先和安柏商量路线'); text.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => button('保存这个字段').click());
    for (let i = 0; i < 100 && node.querySelector('[aria-label="剧情资料编辑"]'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(node.querySelector('[aria-label="剧情资料编辑"]')).toBeNull();
    expect(node.textContent).toContain('先和安柏商量路线'); expect(model).not.toHaveBeenCalled();
    const coldResources = createCoreStoryResources(['mondstadt-story'], load);
    const restored = createCoreController({ repo, storyResources: coldResources, turnDependencies: () => attachCoreStoryResources({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: model, factModel: model, assembleContext: async () => ({ systemPrompt: '', messages: [] }) }, coldResources) });
    await act(async () => { await restored.attach({ scope: seed.head.scope }); });
    expect(restored.getCurrentStoryTitle()).toBe('蒙德序章 · 风中的骑士 · 抵达蒙德城');
    expect((await restored.readStoryCatalog()).find(row => row.nodeId === 'enter-mondstadt')?.goal).toBe('先和安柏商量路线');
    restored.dispose();
  } finally { await act(async () => root.unmount()); controller.dispose(); node.remove(); }
});
