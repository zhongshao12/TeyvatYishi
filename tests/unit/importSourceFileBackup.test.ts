// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImportSourceFileBackup } from '@/services/exportService';

describe('import source-file backup', () => {
  afterEach(() => {
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
    vi.restoreAllMocks();
  });

  it('downloads the original bytes with a content-derived id before import', async () => {
    const bytes = new TextEncoder().encode('{\r\n  "universe": "teyvat"\r\n}\r\n');
    const source = {
      name: '旅行者 存档.json',
      type: 'application/json',
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    } as File;
    let downloadedSize = 0;
    const createObjectURL = vi.fn((blob: Blob) => {
      downloadedSize = blob.size;
      return 'blob:backup';
    });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const result = await createImportSourceFileBackup(source);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(downloadedSize).toBe(bytes.byteLength);
    expect(result.backupId).toMatch(/^sha256-[a-f0-9]{16}$/);
    expect(result.fileName).toMatch(/^旅行者 存档-source-backup-sha256-[a-f0-9]{16}\.json$/);
    expect(result.byteLength).toBe(bytes.byteLength);
    expect(click).toHaveBeenCalledTimes(1);
  });
});
