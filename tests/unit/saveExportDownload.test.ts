// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { 存档数据 } from '@/models/settings';
import { createEmptyTeyvatGameState } from '@/models/teyvat';
import { exportSaveJson } from '@/services/storage/saveImportExportService';

/**
 * 存档导出是玩家唯一的数据备份出口。
 * `anchor.click()` 之后浏览器会**异步**去读 blob URL；同步 `revokeObjectURL(url)`
 * 会让下载拿到已撤销的 URL（下不来 / 0 字节），因此撤销必须晚于点击所在的这一轮同步代码。
 */
describe('save export download lifecycle', () => {
  const blobUrl = 'blob:kaituoyishi-export-test';
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let anchorConnectedAtClick: boolean | null;

  beforeEach(() => {
    anchorConnectedAtClick = null;
    createObjectURL = vi.fn(() => blobUrl);
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      anchorConnectedAtClick = document.body.contains(this);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildSave(): 存档数据 {
    const save = createEmptyTeyvatGameState();
    save.turnCount = 4;
    save.旅行者.姓名 = '荧';
    return save as unknown as 存档数据;
  }

  it('revokes the object URL only after the click task, and never hands the browser a detached anchor', async () => {
    await exportSaveJson(buildSave());

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorConnectedAtClick).toBe(true);
    // 临时 anchor 必须已经清掉，不能留在 DOM 里。
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    // 同步撤销：点击所在的同一轮同步代码里 URL 已被释放，下载可能读到 0 字节。
    expect(revokeObjectURL).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith(blobUrl);
  });

  it('revokes exactly once per export', async () => {
    await exportSaveJson(buildSave());
    await exportSaveJson(buildSave());

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
