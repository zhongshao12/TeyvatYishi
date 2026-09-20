import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const storage = vi.hoisted(() => {
  const records = new Map<string, unknown>();
  return {
    records,
    readJson: vi.fn(async (path: string) => records.get(path) ?? null),
    writeJson: vi.fn(async (path: string, value: unknown) => { records.set(path, value); }),
    readText: vi.fn(async () => null),
    remove: vi.fn(async (path: string) => { records.delete(path); }),
    list: vi.fn(async () => [] as string[]),
  };
});

vi.mock('../../utils/platform/desktopRuntime', () => ({ isDesktopRuntime: () => true }));
vi.mock('../../services/storage/appStorageAdapter', () => ({
  createAppStorageAdapter: () => storage,
}));

import * as desktopSettings from '../../services/desktop/desktopSettingsMirror';

describe('desktop settings batching', () => {
  beforeEach(() => {
    storage.records.clear();
    vi.clearAllMocks();
  });

  it('writes workflow recovery directly to its sidecar without reading the shared settings file', async () => {
    await desktopSettings.mirrorSettingToDesktop('activeWorkflowRecoveryV1', { workflowId: 'w1' });

    expect(storage.readJson).not.toHaveBeenCalledWith('config/settings.json');
    expect(storage.writeJson).toHaveBeenCalledWith(
      'logs/workflow-recovery.json',
      expect.objectContaining({ key: 'activeWorkflowRecoveryV1', value: { workflowId: 'w1' } }),
    );
  });

  it('writes ordinary settings once while keeping sidecars separate', async () => {
    const batchWrite = Reflect.get(desktopSettings, 'mirrorSettingsToDesktop');
    expect(batchWrite).toBeTypeOf('function');

    await batchWrite({
      theme: { id: 'warm' },
      apiSettings: { configs: [] },
      gameSettings: { enableStreaming: true },
      worldbooks: [{ id: 'mondstadt' }],
    });

    const sharedWrites = storage.writeJson.mock.calls.filter(([path]) => path === 'config/settings.json');
    expect(sharedWrites).toHaveLength(1);
    expect(sharedWrites[0]?.[1]).toMatchObject({
      settings: {
        theme: { id: 'warm' },
        apiSettings: { configs: [] },
        gameSettings: { enableStreaming: true },
      },
    });
    expect(storage.writeJson).toHaveBeenCalledWith(
      'worldbooks/worldbooks.json',
      expect.objectContaining({ key: 'worldbooks' }),
    );
  });

  it('commits the end-of-turn settings snapshot in one batch', () => {
    const source = readFileSync(new URL('../../hooks/useGame/sendWorkflow.ts', import.meta.url), 'utf8');

    expect(source).toContain('await saveSettings({');
    expect(source).not.toMatch(/await saveSetting\('(theme|apiSettings|gameSettings|worldbooks)'/);
  });
});
