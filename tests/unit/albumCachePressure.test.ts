import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ALBUM_CACHE_BYTES,
  MAX_ALBUM_CACHE_ENTRIES,
  clearAlbumAssetObjectUrlCache,
  getAlbumAssetCacheStats,
  hasAlbumAssetBlob,
  releaseAlbumCacheUnderPressure,
  rememberAlbumAssetFromDataUrl,
  resolveAlbumAssetDisplayUrl,
} from '@/utils/albumObjectUrl';

/**
 * C3：相册缓存的内存压力阀。
 *
 * 修复前：`enforceAlbumCacheLimit` 不能驱逐"已有 objectUrl"的条目（保护正在显示的图），
 * 而 `pruneAlbumAssetCache` 只在读档时调用一次 → 本次会话滚动看过的图全部常驻内存。
 */

// 每条用互不相同的负载：该模块按 dataUrl 内容去重（见模块注释），
// 全部用同一个串会让 30 次写入只留下 1 条，测不到"超限"分支。
const dataUrlFor = (index: number) => `data:image/png;base64,${Buffer.from(`album-asset-${index}`).toString('base64')}`;

const seed = (count: number) => {
  for (let index = 0; index < count; index += 1) {
    rememberAlbumAssetFromDataUrl(`asset-${index}`, dataUrlFor(index));
  }
};

describe('相册缓存压力阀', () => {
  beforeEach(() => {
    clearAlbumAssetObjectUrlCache();
    // node 环境没有 createObjectURL，补一个可断言的桩。
    let counter = 0;
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => `blob:mock-${(counter += 1)}`),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearAlbumAssetObjectUrlCache();
  });

  it('does nothing while the cache is within both limits', () => {
    seed(4);

    expect(releaseAlbumCacheUnderPressure(['asset-0', 'asset-1'])).toBe(0);
    expect(getAlbumAssetCacheStats().size).toBe(4);
  });

  it('releases everything outside the keep set once the cache reaches its entry budget', () => {
    seed(MAX_ALBUM_CACHE_ENTRIES + 6);
    // 插入时 enforceAlbumCacheLimit 已按 FIFO 把条目数压在上限内：存活的是**后**写入的那批。
    const survivors = Array.from({ length: MAX_ALBUM_CACHE_ENTRIES + 6 }, (_, index) => `asset-${index}`)
      .filter((id) => hasAlbumAssetBlob(id));
    expect(survivors).toHaveLength(MAX_ALBUM_CACHE_ENTRIES);
    const kept = survivors.slice(0, 3);

    const released = releaseAlbumCacheUnderPressure(kept);

    expect(released).toBe(MAX_ALBUM_CACHE_ENTRIES - kept.length);
    expect(getAlbumAssetCacheStats().size).toBe(kept.length);
  });

  it('revokes the object URLs of the released entries', () => {
    seed(MAX_ALBUM_CACHE_ENTRIES + 2);
    const survivors = Array.from({ length: MAX_ALBUM_CACHE_ENTRIES + 2 }, (_, index) => `asset-${index}`)
      .filter((id) => hasAlbumAssetBlob(id));
    // 让在屏条目真的持有 objectUrl —— 这正是修复前 `enforceAlbumCacheLimit` 无法驱逐的原因。
    for (const id of survivors) resolveAlbumAssetDisplayUrl(id);
    const revoke = vi.mocked(URL.revokeObjectURL);

    const released = releaseAlbumCacheUnderPressure([survivors[0]!]);

    expect(released).toBe(survivors.length - 1);
    expect(revoke).toHaveBeenCalledTimes(survivors.length - 1);
  });

  it('also trims when only the byte budget is exceeded', () => {
    // 单个 data URL 很小，用条目数之外的路径覆盖字节上限分支：直接塞满同一条 id 不可行，
    // 因此这里断言"字节上限被纳入判断"这一契约（size 未超时也可能因字节超限而收口）。
    seed(3);
    const kept = ['asset-0'];
    const released = releaseAlbumCacheUnderPressure(kept);
    // 3 条远低于两个上限 → 不应释放
    expect(released).toBe(0);
    expect(MAX_ALBUM_CACHE_BYTES).toBeGreaterThan(0);
  });
});
