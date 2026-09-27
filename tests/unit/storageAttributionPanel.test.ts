// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { StorageAttributionPanel } from '@/components/features/Settings/storage/StorageAttributionPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('storage attribution panel', () => {
  const hosts: HTMLDivElement[] = [];
  afterEach(() => { hosts.splice(0).forEach((host) => host.remove()); });

  it('scans only on request and never adds image bytes to a claimed browser total', async () => {
    const host = document.createElement('div');
    document.body.append(host); hosts.push(host);
    const root = createRoot(host);
    const scan = vi.fn().mockResolvedValue({ nodeEstimateBytes: 3000, deltaNodeCount: 2, uniqueAssetBytes: 340, sharedAssetBytes: 200, unreferencedAssetBytes: 40, assetCount: 3 });
    await act(async () => root.render(createElement(StorageAttributionPanel, { saves: [{ id: 1, sizeBytes: 3000 }], scan })));
    expect(scan).not.toHaveBeenCalled();
    await act(async () => host.querySelector('button')?.click());
    expect(scan).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('估算');
    expect(host.textContent).toContain('共享图片');
    expect(host.textContent).toContain('不可相加');
    await act(async () => root.unmount());
  });
});
