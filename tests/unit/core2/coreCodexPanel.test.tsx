// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createIndexedRepository } from '@/core/persistence/indexedRepository';
import { createCoreController } from '@/core/settlement/coreController';
import { createCoreCodexCatalog } from '@/core/content/codexCatalog';
import { Core2App } from '@/components/features/Core2/Core2App';
import { makeSeed } from './fixtures';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

it('opens characters, terms and story for the player without discovery writes or model calls', async () => {
  const seed = makeSeed(), npc = seed.records.find(row => row.domain === 'npc'); if (npc?.domain !== 'npc') throw Error('fixture');
  npc.value.appearanceFacts = { 发色: { value: '红棕色', source: 'manual' }, 瞳色: { value: '琥珀色', source: 'canon' } };
  const load = vi.fn(async () => ({ 条目: [
    { id: 'amber-card', 标题: '安柏', 分类: 'character', 摘要: '侦察骑士', 原文: '## 外貌\n- 外貌：紫色长发，紫色眼眸。', 关键词: ['安柏'] },
    { id: 'vision-card', 标题: '神之眼', 分类: 'term', 摘要: '元素力', 原文: '神之眼引导元素力。', 关键词: ['神之眼'] },
    { id: 'story-card', 标题: '蒙德序章', 分类: 'story', 摘要: '未经历的剧情参考。', 原文: '巨龙与自由的诗歌。', 关键词: ['蒙德'] },
  ] }));
  const repo = createIndexedRepository({ factory: new IDBFactory(), databaseName: `test-core2-codex-ui-${crypto.randomUUID()}` }), model = vi.fn();
  const controller = createCoreController({ repo, contentCatalog: createCoreCodexCatalog(load), turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, generateNarrative: model, factModel: model, assembleContext: async () => ({ systemPrompt: '', messages: [] }) }) });
  await controller.initialize(seed);
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  try {
    await act(async () => root.render(<Core2App repo={repo} controller={controller} />)); expect(load).not.toHaveBeenCalled();
    const open = [...node.querySelectorAll('button')].find(row => row.textContent === '提瓦特图鉴'); expect(open).toBeTruthy();
    await act(async () => open!.click());
    for (let i = 0; i < 100 && !node.textContent?.includes('琥珀色'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    expect(node.textContent).toContain('红棕色'); expect(node.textContent).toContain('琥珀色'); expect(node.textContent).not.toContain('紫色');
    const category = (name: string) => [...node.querySelectorAll<HTMLButtonElement>('[aria-label="图鉴分类"] button')].find(row => row.textContent === name)!;
    await act(async () => category('术语').click()); expect(node.textContent).toContain('神之眼引导元素力。');
    await act(async () => category('剧情').click()); expect(node.textContent).toContain('巨龙与自由的诗歌。');
    expect((await repo.readHead(seed.head.scope)).coreSeq).toBe(0); expect(model).not.toHaveBeenCalled(); expect(load).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); controller.dispose(); node.remove(); }
});
