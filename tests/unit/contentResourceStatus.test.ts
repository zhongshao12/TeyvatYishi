import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundledCodexPresets, loadBundledCodexPreset } from '@/data/codexPreset';
import { loadBundledWorldbookPreset } from '@/data/openingWorldbookPreset';
import {
  ContentResourceError,
  clearContentResourceStatuses,
  getContentResourceStatus,
  getContentResourceStatuses,
  markContentResourceReady,
  subscribeContentResourceStatuses,
} from '@/services/contentResourceStatus';

const preset = bundledCodexPresets[0]!;

describe('content resource status', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearContentResourceStatuses();
  });

  it('keeps a bounded, subscribable metadata-only snapshot', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeContentResourceStatuses(listener);
    for (let i = 0; i < 210; i += 1) markContentResourceReady(`scenario:${i}`);
    expect(getContentResourceStatuses()).toHaveLength(200);
    expect(listener).toHaveBeenCalled();
    expect(getContentResourceStatus('scenario:209')?.state).toBe('ready');
    unsubscribe();
  });

  it('records a fetch failure with resource ID and stage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private network details')));
    await expect(loadBundledCodexPreset(preset)).rejects.toMatchObject({
      name: 'ContentResourceError', resourceId: `codex:${preset.id}`, stage: 'fetch',
    } satisfies Partial<ContentResourceError>);
    expect(getContentResourceStatus(`codex:${preset.id}`)).toMatchObject({
      state: 'failed', stage: 'fetch',
    });
    expect(JSON.stringify(getContentResourceStatuses())).not.toContain('private network details');
  });

  it('records malformed JSON as parse failure without masking saved data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ wrong: [] }) }));
    await expect(loadBundledCodexPreset(preset)).rejects.toMatchObject({
      resourceId: `codex:${preset.id}`, stage: 'parse',
    });
    expect(getContentResourceStatus(`codex:${preset.id}`)?.recoveryHint).toBeTruthy();
  });

  it('marks valid empty entries ready', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entries: [] }) }));
    await loadBundledCodexPreset(preset);
    expect(getContentResourceStatus(`codex:${preset.id}`)?.state).toBe('ready');
  });

  it('reports bundled worldbook schema errors with its own resource ID', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ wrong: [] }) }));
    await expect(loadBundledWorldbookPreset({ id: 'test', title: '测试', description: '', path: '/test.json' }))
      .rejects.toMatchObject({ resourceId: 'worldbook:test', stage: 'parse' });
  });
});
