// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ContentResourceStatusPanel } from '@/components/features/Settings/storage/ContentResourceStatusPanel';
import { clearContentResourceStatuses, markContentResourceFailed, markContentResourceReady } from '@/services/contentResourceStatus';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('content resource status panel', () => {
  afterEach(() => clearContentResourceStatuses());

  it('shows failed ID, stage and recovery hint while keeping statuses inspectable', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(ContentResourceStatusPanel)));
    await act(async () => {
      markContentResourceReady('opening:ready');
      markContentResourceFailed('codex:broken', 'parse', '请检查安装文件后刷新页面。');
    });
    expect(host.textContent).toContain('codex:broken');
    expect(host.textContent).toContain('parse');
    expect(host.textContent).toContain('请检查安装文件后刷新页面');
    expect(host.textContent).toContain('opening:ready');
    await act(async () => root.unmount());
    host.remove();
  });
});
