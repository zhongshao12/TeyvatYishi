// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('streaming preview delay controller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('skips the reveal animation when reduced motion is requested', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const module = await import('../../utils/streamingPreviewDelay');
    const controller = module.createStreamingPreviewDelayController();

    expect(controller.interrupted).toBe(true);
    await expect(controller.wait(30)).resolves.toBeUndefined();
    controller.dispose();
  });

  it('registers visibility and abort listeners once for all chunks', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const signal = new AbortController().signal;
    const signalAdd = vi.spyOn(signal, 'addEventListener');
    const module = await import('../../utils/streamingPreviewDelay');
    const controller = module.createStreamingPreviewDelayController(signal);

    await controller.wait(0);
    await controller.wait(0);
    controller.dispose();

    expect(documentAdd.mock.calls.filter(([type]) => type === 'visibilitychange')).toHaveLength(1);
    expect(signalAdd.mock.calls.filter(([type]) => type === 'abort')).toHaveLength(1);
  });
});
