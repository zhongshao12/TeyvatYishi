import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorkflowSources } from '../../scripts/lib/workflowSources.mjs';

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
        gameSettings: { enableStreaming: true },
      },
    });
    // 携带 API Key 的设置必须走专用 sidecar，而不是共享的 settings.json。
    expect((sharedWrites[0]?.[1] as { settings: Record<string, unknown> }).settings).not.toHaveProperty('apiSettings');
    expect(storage.writeJson).toHaveBeenCalledWith(
      'config/api-settings.json',
      expect.objectContaining({ key: 'apiSettings', value: { configs: [] } }),
    );
    expect(storage.writeJson).toHaveBeenCalledWith(
      'worldbooks/worldbooks.json',
      expect.objectContaining({ key: 'worldbooks' }),
    );
  });

  it('keeps provider API keys out of the shared config/settings.json mirror', async () => {
    const batchWrite = Reflect.get(desktopSettings, 'mirrorSettingsToDesktop');
    const secret = 'sk-live-mirror-secret';

    await batchWrite({
      theme: { id: 'warm' },
      apiSettings: { activeConfigId: 'a', configs: [{ id: 'a', apiKey: secret }] },
      gameSettings: { enableStreaming: true },
    });

    const sharedWrites = storage.writeJson.mock.calls.filter(([path]) => path === 'config/settings.json');
    const sharedText = JSON.stringify(sharedWrites.map(([, value]) => value));
    expect(sharedText).not.toContain(secret);
    expect(sharedText).not.toContain('apiKey');

    // 取舍：Key 仍然持久化在专用 sidecar 里，保证重启后主剧情/变量等仍能直接使用。
    expect(JSON.stringify(storage.records.get('config/api-settings.json'))).toContain(secret);
  });

  it('commits the end-of-turn settings snapshot in one batch', () => {
    // 读工作流源码视图，而非写死 sendWorkflow.ts：M6 已把收尾存档搬到独立阶段模块，const source = workflowSources 会随搬迁自动跟随（后续拆分不会再打红本测试）。
    const source = readWorkflowSources();

    expect(source).toContain('await saveSettings({');
    expect(source).not.toMatch(/await saveSetting\('(theme|apiSettings|gameSettings|worldbooks)'/);
  });
});
