// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useGamePanelPreload } from '@/hooks/useGamePanelPreload';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Panels = Parameters<typeof useGamePanelPreload>[1];
const roots: Root[] = [];
let callbacks: Map<number, IdleRequestCallback>;

function Page({ turnCount, panels }: { turnCount: number; panels: Panels }) {
  useGamePanelPreload(turnCount, panels);
  return createElement('div', null, `回合 ${turnCount}`);
}

async function mount(panels: Panels, turnCount = 1, strict = false) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const render = async (nextTurnCount: number) => {
    const page = createElement(Page, { turnCount: nextTurnCount, panels });
    await act(async () => root.render(strict ? createElement(StrictMode, null, page) : page));
  };
  await render(turnCount);
  return { root, host, render };
}

async function runIdleTurn() {
  const scheduled = callbacks.entries().next().value;
  expect(scheduled).toBeDefined();
  const [id, callback] = scheduled!;
  callbacks.delete(id);
  await act(async () => callback({ didTimeout: false, timeRemaining: () => 5 }));
}

beforeEach(() => {
  callbacks = new Map();
  let id = 0;
  vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
    callbacks.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelIdleCallback', (key: number) => callbacks.delete(key));
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('game panel preload React lifecycle', () => {
  it('continues its pending idle batch across actual turn 1 to 2 rerenders', async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const page = await mount([{ preload: first }, { preload: second }]);
    await runIdleTurn();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(1);
    await page.render(2);
    expect(page.host.textContent).toBe('回合 2');
    expect(callbacks.size).toBe(1);
    await runIdleTurn();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('cancels while disabled and can start again after re-enabling', async () => {
    const preload = vi.fn(async () => {});
    const page = await mount([{ preload }], 0);
    expect(callbacks.size).toBe(0);
    await page.render(1);
    expect(callbacks.size).toBe(1);
    await page.render(0);
    expect(callbacks.size).toBe(0);
    expect(preload).not.toHaveBeenCalled();
    await page.render(1);
    expect(callbacks.size).toBe(1);
    await runIdleTurn();
    expect(preload).toHaveBeenCalledTimes(1);
  });

  it('does not schedule the next panel when disabled during an in-flight preload', async () => {
    let finish!: () => void;
    const first = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const second = vi.fn(async () => {});
    const page = await mount([{ preload: first }, { preload: second }]);
    await runIdleTurn();
    expect(first).toHaveBeenCalledTimes(1);
    await page.render(0);
    await act(async () => finish());
    expect(callbacks.size).toBe(0);
    expect(second).not.toHaveBeenCalled();
  });

  it('survives StrictMode effect cleanup and cancels pending work on unmount', async () => {
    const preload = vi.fn(async () => {});
    const page = await mount([{ preload }], 1, true);
    expect(callbacks.size).toBe(1);
    await runIdleTurn();
    expect(preload).toHaveBeenCalledTimes(1);
    await page.render(0);
    await page.render(1);
    expect(callbacks.size).toBe(1);
    await act(async () => page.root.unmount());
    roots.splice(roots.indexOf(page.root), 1);
    expect(callbacks.size).toBe(0);
    expect(preload).toHaveBeenCalledTimes(1);
  });
});
