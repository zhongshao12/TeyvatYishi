import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readWorkflowSources } from '../../scripts/lib/workflowSources.mjs';

const storage = vi.hoisted(() => {
  const records = new Map<string, unknown>();
  // 模拟真实桌面适配器的磁盘延迟：readJson 与 writeJson 都是异步 IO，
  // 不能在同一微任务里返回。若模块没有读改写串行化，两次并发保存会互相覆盖。
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 3));
  return {
    records,
    settle,
    readJson: vi.fn(async (path: string) => {
      await settle();
      return records.get(path) ?? null;
    }),
    writeJson: vi.fn(async (path: string, value: unknown) => {
      await settle();
      // 存快照而非引用：真实适配器写入的是 JSON 文本，别名会掩盖丢 key。
      records.set(path, JSON.parse(JSON.stringify(value)) as unknown);
    }),
    readText: vi.fn(async () => null),
    remove: vi.fn(async (path: string) => {
      await settle();
      records.delete(path);
    }),
    list: vi.fn(async () => [] as string[]),
  };
});

vi.mock('../../utils/platform/desktopRuntime', () => ({ isDesktopRuntime: () => true }));
vi.mock('../../services/storage/appStorageAdapter', () => ({
  createAppStorageAdapter: () => storage,
}));

import * as desktopSettings from '../../services/desktop/desktopSettingsMirror';

type SharedMirror = { settings: Record<string, unknown> };

function sharedMirrorSettings(): Record<string, unknown> {
  return (storage.records.get('config/settings.json') as SharedMirror | undefined)?.settings ?? {};
}

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

  it('keeps both keys when two settings are saved concurrently (lost-update guard)', async () => {
    await Promise.all([
      desktopSettings.mirrorSettingToDesktop('gameSettings', { enableStreaming: true }),
      desktopSettings.mirrorSettingToDesktop('worldState', { day: 7 }),
    ]);

    expect(sharedMirrorSettings()).toMatchObject({
      gameSettings: { enableStreaming: true },
      worldState: { day: 7 },
    });
  });

  it('keeps every key when many saves of the same file race', async () => {
    await Promise.all([
      desktopSettings.mirrorSettingToDesktop('gameSettings', { wordCountTarget: 1200 }),
      desktopSettings.mirrorSettingToDesktop('worldState', { hour: 11 }),
      desktopSettings.mirrorSettingsToDesktop({ theme: { id: 'warm' } }),
      desktopSettings.mirrorSettingToDesktop('mobileSettings', { notifications: true }),
    ]);

    expect(sharedMirrorSettings()).toMatchObject({
      gameSettings: { wordCountTarget: 1200 },
      worldState: { hour: 11 },
      theme: { id: 'warm' },
      mobileSettings: { notifications: true },
    });
  });

  it('does not resurrect a key that a concurrent delete removed', async () => {
    await desktopSettings.mirrorSettingToDesktop('gameSettings', { wordCountTarget: 900 });
    await desktopSettings.mirrorSettingToDesktop('legacyScratch', { value: 1 });

    await Promise.all([
      desktopSettings.mirrorSettingToDesktop('worldState', { day: 3 }),
      desktopSettings.removeSettingFromDesktopMirror('legacyScratch'),
    ]);

    const settings = sharedMirrorSettings();
    expect(settings.worldState).toEqual({ day: 3 });
    expect(settings).not.toHaveProperty('legacyScratch');
    expect(settings.gameSettings).toEqual({ wordCountTarget: 900 });
  });

  it('keeps the last value of the same key when the same key is written twice concurrently', async () => {
    await Promise.all([
      desktopSettings.mirrorSettingToDesktop('worldState', { day: 1 }),
      desktopSettings.mirrorSettingToDesktop('worldState', { day: 2 }),
    ]);
    await desktopSettings.mirrorSettingToDesktop('worldState', { day: 3 });

    expect(sharedMirrorSettings().worldState).toEqual({ day: 3 });
  });

  it('keeps ordinary updates after a concurrent special-key write', async () => {
    await Promise.all([
      desktopSettings.mirrorSettingToDesktop('gameSettings', { enableStreaming: true }),
      desktopSettings.mirrorSettingToDesktop('worldbooks', [{ id: 'mondstadt' }]),
      desktopSettings.mirrorSettingToDesktop('apiSettings', { configs: [] }),
    ]);

    expect(sharedMirrorSettings().gameSettings).toEqual({ enableStreaming: true });
    expect(sharedMirrorSettings()).not.toHaveProperty('worldbooks');
    expect(storage.records.get('worldbooks/worldbooks.json')).toMatchObject({
      key: 'worldbooks',
      value: [{ id: 'mondstadt' }],
    });
    expect(storage.records.get('config/api-settings.json')).toMatchObject({
      key: 'apiSettings',
      value: { configs: [] },
    });
  });

  it('keeps both keys when the settings page saves them through one Promise.all batch', async () => {
    // 直接复刻 GameSettings.tsx 的保存方式：两个 saveSetting 并发。
    const saveSetting = (key: string, value: unknown) => desktopSettings.mirrorSettingToDesktop(key, value);

    await Promise.all([
      saveSetting('gameSettings', { wordCountTarget: 800, narrativePerson: 'second' }),
      saveSetting('worldState', { day: 12, hour: 9 }),
    ]);

    expect(sharedMirrorSettings()).toMatchObject({
      gameSettings: { wordCountTarget: 800, narrativePerson: 'second' },
      worldState: { day: 12, hour: 9 },
    });
  });

  it('keeps a saved key recoverable through the desktop mirror read path', async () => {
    await Promise.all([
      desktopSettings.mirrorSettingToDesktop('gameSettings', { wordCountTarget: 1500 }),
      desktopSettings.mirrorSettingToDesktop('worldState', { day: 4 }),
    ]);

    // 重启后桌面优先从镜像读取：这里模拟重启后的读取。
    await expect(desktopSettings.loadSettingFromDesktopMirror('gameSettings'))
      .resolves.toEqual({ wordCountTarget: 1500 });
    await expect(desktopSettings.loadSettingFromDesktopMirror('worldState'))
      .resolves.toEqual({ day: 4 });
  });

  it('leaves global settings persistence to settings editing entry points', () => {
    // A03: the turn snapshot is stale after settings edits during generation.
    // Batch/mirror guarantees remain covered above; a turn must not save that snapshot.
    // Runtime ownership is covered by autoSaveSettingsOwnership.test.ts.
    const source = readWorkflowSources();

    expect(source).not.toContain('await saveSettings({');
    expect(source).not.toMatch(/await saveSetting\('(theme|apiSettings|gameSettings|worldbooks)'/);
  });
});
