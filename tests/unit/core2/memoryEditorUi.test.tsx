// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Core2App } from '@/components/features/Core2/Core2App';
import { createCoreController } from '@/core/settlement/coreController';
import { makeMemoryMaintenanceFixture } from './memoryMaintenanceFixture';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

it.each(['旅途记忆', '世界树'])('edits and pins a memory from the actual %s page, preserving drafts on a version conflict', async page => {
  const f = await makeMemoryMaintenanceFixture(), controller = createCoreController({ repo: f.repo, autoSave: false, turnDependencies: () => ({ rulePolicy: { ruleVersion: 'test', storyNodes: [] }, assembleContext: async () => ({ systemPrompt: '', messages: [] }), generateNarrative: vi.fn(), factModel: vi.fn() }) });
  await controller.attach({ scope: f.seed.head.scope });
  const node = document.createElement('div'); document.body.append(node); const root = createRoot(node), edit = vi.spyOn(controller, 'editMemory');
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(row => row.textContent === text)!;
  try {
    await act(async () => root.render(<Core2App controller={controller} repo={f.repo} />));
    await act(async () => button(page).click());
    if (page === '世界树') await act(async () => { const select = node.querySelector<HTMLSelectElement>('.core2-memory-workspace select')!; select.value = 'short'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); }); expect(button('编辑记忆')).toBeDefined(); });
    await act(async () => button('编辑记忆').click());
    const input = document.querySelector<HTMLTextAreaElement>('[aria-label="记忆表述"]')!, text = '玩家手动校正，不改写历史事实。';
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector<HTMLInputElement>('[aria-label="固定这条记忆"]')!.click(); });
    edit.mockRejectedValueOnce(Error('记忆已被修改，请重新打开编辑'));
    await act(async () => { button('保存记忆').click(); await edit.mock.results[0]!.value.catch(() => undefined); });
    expect(document.body.textContent).toContain('记忆已被修改');
    expect(input.value).toBe(text);
    await act(async () => { button('保存记忆').click(); await vi.waitFor(() => expect(edit).toHaveBeenCalledTimes(2)); await edit.mock.results[1]!.value; });
    expect(document.querySelector('[aria-label="编辑记忆"]')).toBeNull();
    const head = await f.repo.readHead(f.seed.head.scope), saved = (await f.repo.queryMemories({ scope: head.scope, cutoffSeq: head.coreSeq, memoryRevision: head.memoryRevision })).items.find(row => row.text === text);
    expect(saved).toMatchObject({ pinned: true, editVersion: 1 });
  } finally { await act(async () => root.unmount()); controller.dispose(); node.remove(); }
});
