import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => {
  const records = new Map<string, unknown>();
  return {
    records,
    readJson: vi.fn(async (path: string) => records.get(path) ?? null),
    writeJson: vi.fn(async (path: string, value: unknown) => { records.set(path, value); }),
    writeBase64File: vi.fn(async () => undefined),
    readBase64File: vi.fn(async () => null),
    remove: vi.fn(async () => undefined),
    list: vi.fn(async () => [] as string[]),
  };
});

vi.mock('../../utils/platform/desktopRuntime', () => ({ isDesktopRuntime: () => true }));
vi.mock('../../services/storage/appStorageAdapter', () => ({
  createAppStorageAdapter: () => storage,
}));

import { mirrorAssetRecordsToDesktop } from '../../services/desktop/desktopAssetMirror';
import { extractSaveAssetRecords } from '../../utils/saveAssetStorage';

describe('desktop asset mirror incremental writes', () => {
  beforeEach(() => {
    storage.records.clear();
    vi.clearAllMocks();
  });

  it('does not read or rewrite an unchanged binary payload', async () => {
    storage.records.set('assets/index.json', {
      version: 1,
      updatedAt: 100,
      assets: [{
        id: 'asset-1',
        path: 'assets/generated-images/asset-1.png',
        metadataPath: 'assets/generated-images/asset-1.meta.json',
        mimeType: 'image/png',
        size: 4,
        updatedAt: 100,
      }],
    });
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
    const arrayBuffer = vi.spyOn(blob, 'arrayBuffer');

    await mirrorAssetRecordsToDesktop([{
      id: 'asset-1',
      blob,
      mimeType: 'image/png',
      size: 4,
      updatedAt: 100,
    }]);

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(storage.writeBase64File).not.toHaveBeenCalled();
    expect(storage.writeJson).not.toHaveBeenCalled();
  });

  it('keeps an album asset revision stable across save extraction', () => {
    const save = {
      相册: {
        assets: [{
          id: 'asset-stable',
          dataUrl: 'data:image/png;base64,AQIDBA==',
          source: 'generated',
          nsfw: false,
          status: 'ready',
          createdAt: 2468,
        }],
      },
    };

    expect(extractSaveAssetRecords(save as never)[0]?.updatedAt).toBe(2468);
  });
});
