// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRebuildModal } from '@/components/layout/AppPanels';
import { SystemDrawer } from '@/components/layout/SystemDrawer';
import { Modal } from '@/components/ui/Modal';
import { createMemoryRebuildTask, type MemoryRebuildTask } from '@/services/memoryRebuild';
import type { 聊天消息 } from '@/models/chat';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => { roots.splice(0).forEach(root => act(() => root.unmount())); document.body.innerHTML = ''; });
function mount(element: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); roots.push(root);
  act(() => root.render(element)); return host;
}
function button(label: string) { return Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === label)!; }
function history(skip: number[] = []): 聊天消息[] {
  return Array.from({ length: 15 }, (_, i) => i + 1).filter(i => !skip.includes(i)).flatMap(i => [
    { id: `u${i}`, role: 'user' as const, content: `请求${i}`, gameTime: `${i}`, timestamp: i },
    { id: `a${i}`, role: 'assistant' as const, content: `正文${i}`, gameTime: `${i}`, timestamp: i },
  ]);
}
const emptyTask = () => createMemoryRebuildTask({ chatHistory: history(), batchSize: 15 });

it('portals above the drawer, traps Tab and closes only the top layer with focus restored', async () => {
  const drawerClose = vi.fn(); const abort = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return <><SystemDrawer open title="记忆系统" onClose={drawerClose}><button onClick={() => setOpen(true)}>批量重建入口</button></SystemDrawer>
      {open && <MemoryRebuildModal defaultEnd={15} onClose={() => setOpen(false)} onAbort={abort} onRun={async () => emptyTask()} />}</>;
  }
  const host = mount(<Harness />);
  const trigger = button('批量重建入口'); trigger.focus(); await act(async () => trigger.click());
  const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find(el => el.textContent?.includes('开始回合'))!;
  expect(host.contains(dialog)).toBe(false); expect(dialog.parentElement?.parentElement).toBe(document.body);
  expect(Number(dialog.parentElement?.style.zIndex)).toBeGreaterThan(50);
  button('开始重建').focus(); await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
  expect(dialog.contains(document.activeElement)).toBe(true);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(drawerClose).not.toHaveBeenCalled(); expect(abort).not.toHaveBeenCalled(); expect(document.activeElement).toBe(trigger);
});

it('shows actual recoverable calls and missing turns before generating any summary', async () => {
  const run = vi.fn();
  mount(<MemoryRebuildModal defaultEnd={15} chatHistory={history([4, 7])} onRun={run} onClose={() => {}} onAbort={() => {}} />);
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(document.body.textContent).toContain('基础模型调用：13 次');
  expect(document.body.textContent).toContain('4、7'); expect(document.body.textContent).toContain('仅替换');
  expect(document.body.textContent).not.toContain('全部批次成功后才替换即时'); expect(run).not.toHaveBeenCalled();
});

it('starts one request on double click, displays per-turn progress, and cancels without a saved-success claim', async () => {
  let finish!: () => void; const run = vi.fn((options: Parameters<React.ComponentProps<typeof MemoryRebuildModal>['onRun']>[0]) => {
    options.onProgress({ completedBatches: 0, totalBatches: 1, currentBatch: 1, processedTurns: 2, totalTurns: 15, phase: 'turns', currentTurn: 2 });
    return new Promise<MemoryRebuildTask>(resolve => { finish = () => resolve({ ...emptyTask(), status: 'cancelled' }); });
  });
  const abort = vi.fn(); mount(<MemoryRebuildModal defaultEnd={15} onRun={run} onClose={() => {}} onAbort={abort} />);
  await act(async () => { button('开始重建').click(); button('开始重建').click(); });
  expect(run).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain('当前回合：2'); expect(document.body.textContent).toContain('2/15');
  await act(async () => button('取消重建').click()); expect(abort).toHaveBeenCalledTimes(1);
  await act(async () => finish()); expect(document.body.textContent).toContain('取消'); expect(document.body.textContent).not.toContain('已自动保存');
});

it('retries only the committed result when persistence failed and keeps the save warning honest', async () => {
  const task = { ...emptyTask(), status: 'committed' as const, persistence: 'failed' as const };
  const run = vi.fn(async (_options: Parameters<React.ComponentProps<typeof MemoryRebuildModal>['onRun']>[0]) => task);
  mount(<MemoryRebuildModal defaultEnd={15} onRun={run} onClose={() => {}} onAbort={() => {}} />);
  await act(async () => button('开始重建').click());
  expect(document.body.textContent).toContain('保存失败'); expect(document.body.textContent).not.toContain('并自动保存');
  await act(async () => button('重试保存').click()); expect(run.mock.calls[1]?.[0]?.task).toBe(task);
});

it('keeps ordinary modal mount and layer unchanged', () => {
  const host = mount(<Modal title="普通对话框" onClose={() => {}}>普通内容</Modal>);
  expect(host.querySelector('[role="dialog"]')).not.toBeNull(); expect(host.firstElementChild?.classList.contains('z-50')).toBe(true);
});
