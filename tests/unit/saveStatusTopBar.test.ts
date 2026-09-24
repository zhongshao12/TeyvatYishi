// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TopBar } from '@/components/layout/TopBar';
import { 创建空世界状态 } from '@/models/world';
import { createEmptySteambirdNews } from '@/models/teyvat';
import type { SaveStatusSnapshot } from '@/utils/saveStatus';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
});

it('shows real save phases and exposes a retry action without rendering an internal error', async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const onRetrySave = vi.fn();
  const base: SaveStatusSnapshot = { sessionId: 3, phase: 'unsaved', source: null, savedAt: null, hadFailure: false };
  const render = async (saveStatus: SaveStatusSnapshot) => {
    await act(async () => root.render(createElement(TopBar, {
      worldState: 创建空世界状态(), currentTheme: 'mondstadt', onHome: vi.fn(),
      steambird: createEmptySteambirdNews(),
      apiSettings: { activeConfigId: null, configs: [] }, onApiSettingsChange: vi.fn(),
      saveStatus, onRetrySave,
    })));
  };

  await render(base);
  expect(host.textContent).toContain('有未保存更改');
  await render({ ...base, phase: 'saving', source: 'manual' });
  expect(host.textContent).toContain('正在手动保存');
  await render({ ...base, phase: 'saved', source: 'auto', savedAt: 1_700_000_000_000 });
  expect(host.textContent).toContain('自动存档已保存');
  expect(host.textContent).toMatch(/\d{2}:\d{2}/);
  await render({ ...base, phase: 'failed', source: 'auto', hadFailure: true });
  expect(host.textContent).toContain('自动保存失败');
  expect(host.textContent).not.toContain('disk unavailable');
  const retry = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.trim() === '重试保存');
  expect(retry).toBeTruthy();
  await act(async () => retry?.click());
  expect(onRetrySave).toHaveBeenCalledTimes(1);
});
