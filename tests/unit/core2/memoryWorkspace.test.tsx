// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CoreMemoryWorkspace } from '@/components/features/Core2/CoreMemoryWorkspace';
import { recallFixture } from './recallFixture';
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

it('opens a focused rebuild preview above the memory workspace and restores focus on cancel, without calling the model', async () => {
  const f = await recallFixture(1); await f.publish({ memoryId: 'selectable-memory' });
  const head = await f.repo.readHead(f.seed.head.scope), node = document.createElement('div'); document.body.append(node); const root = createRoot(node);
  const preview = vi.fn().mockResolvedValue({ token: 'preview', turns: [1], modelRequests: 1, description: '第1回合' }), run = vi.fn().mockResolvedValue({ kind: 'completed' });
  await act(async () => root.render(<CoreMemoryWorkspace repo={f.repo} head={head} onPreview={preview} onRun={run} />));
  for (let i = 0; i < 100 && !node.querySelector('input[type="checkbox"]'); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  await act(async () => (node.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  const button = [...node.querySelectorAll('button')].find(button => button.textContent === '重建选中记忆')!;
  await act(async () => { button.focus(); button.click(); });
  const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
  expect(dialog).not.toBeNull(); expect(dialog.textContent).toContain('1 次基础请求'); expect(dialog.contains(document.activeElement)).toBe(true);
  expect(run).not.toHaveBeenCalled(); expect(preview).toHaveBeenCalledExactlyOnceWith('rebuild', ['selectable-memory']);
  await act(async () => [...dialog.querySelectorAll('button')].find(button => button.textContent === '取消')!.click());
  expect(document.body.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(button);
  await act(async () => root.unmount()); node.remove();
});
