// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFLINE_HINT, readNetworkOnline, useNetworkStatus } from '@/hooks/useNetworkStatus';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * 断网检测：全仓此前 `navigator.onLine` 0 处引用，断网时玩家只能白等首字节看门狗（45 秒）
 * 才看到失败提示。这里锁两件事：
 *  1. 状态跟 navigator.onLine + online/offline 事件同步；
 *  2. 断网文案是中文可行动文案（与共享的 Failed to fetch 映射一致），不是英文传输错误。
 */
describe('useNetworkStatus', () => {
  let host: HTMLDivElement;
  let root: Root;
  let online = true;

  function Probe() {
    const status = useNetworkStatus();
    return createElement('span', { 'data-online': String(status.online) }, status.online ? '在线' : '离线');
  }

  beforeEach(() => {
    online = true;
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('reports the mapped Chinese offline hint instead of the raw Failed to fetch', () => {
    expect(OFFLINE_HINT).toBe('网络不可用，请检查连接');
    expect(OFFLINE_HINT).not.toContain('Failed to fetch');
  });

  it('tracks navigator.onLine and the online/offline events', async () => {
    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(host.textContent).toBe('在线');
    expect(readNetworkOnline()).toBe(true);

    act(() => {
      online = false;
      window.dispatchEvent(new Event('offline'));
    });
    expect(host.textContent).toBe('离线');
    expect(host.firstElementChild?.getAttribute('data-online')).toBe('false');
    expect(readNetworkOnline()).toBe(false);

    act(() => {
      online = true;
      window.dispatchEvent(new Event('online'));
    });
    expect(host.textContent).toBe('在线');
  });

  it('picks up a connection change that happened before the listeners were attached', async () => {
    online = false;
    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(host.textContent).toBe('离线');
  });

  it('detaches both listeners on unmount', async () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    await act(async () => {
      root.render(createElement(Probe));
    });
    await act(async () => root.unmount());
    const removed = removeEventListener.mock.calls.map((call) => call[0]);
    expect(removed).toContain('online');
    expect(removed).toContain('offline');
  });
});
