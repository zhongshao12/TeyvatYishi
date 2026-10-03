import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { 相册系统 } from '@/models/imageGeneration';
import { 解析相册资源引用, 读取相册条目地址, 创建相册资源引用 } from '@/utils/albumActions';
import {
  clearAlbumAssetObjectUrlCache,
  getAlbumAssetBlob,
  getAlbumAssetCacheStats,
  rememberAlbumAssetFromDataUrl,
  resolveAlbumAssetDisplayUrl,
} from '@/utils/albumObjectUrl';

/**
 * P1-B01：独立头像（inline dataURL）解析**不得**覆盖无关资源的缓存字节。
 *
 * 修复前 `解析相册资源引用` 的匹配条件是：
 *   `item.dataUrl === trimmed || (item.id && resolveAlbumAssetDisplayUrl(item.id))`
 * 第二个分支对「任何已有 objectUrl 的资源」都为真，于是把头像字节
 * `rememberAlbumAssetFromDataUrl(无关资源id, 头像dataUrl)` 写进了无关资源。
 *
 * 审查者内存复现：无关资源内容原为 `other`，解析独立头像 `original` 后，无关资源也变成 `original`。
 */

const bytesOf = async (value: string): Promise<string> => {
  const blob = getAlbumAssetBlob(value);
  if (!blob) throw new Error(`资源缓存里没有 ${value}`);
  return Buffer.from(await blob.arrayBuffer()).toString('utf8');
};

const dataUrlOf = (text: string) => `data:image/png;base64,${Buffer.from(text).toString('base64')}`;

const OTHER_ENTRY_ID = 'album_other';
const OTHER_ASSET_ID = 'asset_other';

function albumWithOneUnrelatedEntry(): 相册系统 {
  return {
    assets: [{
      id: OTHER_ASSET_ID,
      dataUrl: 创建相册资源引用(OTHER_ASSET_ID),
      source: 'generated',
      nsfw: false,
      createdAt: 1,
      status: 'ready',
    }],
    entries: [{
      id: OTHER_ENTRY_ID,
      assetId: OTHER_ASSET_ID,
      title: '无关图片',
      targetType: 'misc',
      slot: 'misc',
      tags: [],
      nsfw: false,
      createdAt: 1,
      referenceTargets: [],
    }],
    tasks: [],
  };
}

describe('B01 独立头像解析不改变其它资源字节', () => {
  beforeEach(() => {
    clearAlbumAssetObjectUrlCache();
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

  it('resolving an inline avatar dataURL leaves unrelated asset bytes untouched', async () => {
    // 无关资源已有显示缓存（正是修复前那个分支为真的条件）。
    rememberAlbumAssetFromDataUrl(OTHER_ASSET_ID, dataUrlOf('other'));
    expect(resolveAlbumAssetDisplayUrl(OTHER_ASSET_ID)).toBeTruthy();
    const album = albumWithOneUnrelatedEntry();

    const avatarDataUrl = dataUrlOf('original');
    const resolved = 解析相册资源引用(album, avatarDataUrl);

    // 解析本身仍要返回可显示地址（头像不能被解析吃掉）。
    expect(resolved).toBeTruthy();
    // 关键断言：无关资源的**字节**没有被头像覆盖。
    expect(await bytesOf(OTHER_ASSET_ID)).toBe('other');
  });

  it('the unrelated gallery entry still displays its own content after the avatar is resolved', async () => {
    rememberAlbumAssetFromDataUrl(OTHER_ASSET_ID, dataUrlOf('other'));
    resolveAlbumAssetDisplayUrl(OTHER_ASSET_ID);
    const album = albumWithOneUnrelatedEntry();

    解析相册资源引用(album, dataUrlOf('original'));

    const displayUrl = 读取相册条目地址(album, OTHER_ENTRY_ID);
    expect(displayUrl).toBe('blob:mock-1');
    expect(await bytesOf(OTHER_ASSET_ID)).toBe('other');
  });

  it('does not add cache entries for unrelated assets while resolving an avatar', () => {
    rememberAlbumAssetFromDataUrl(OTHER_ASSET_ID, dataUrlOf('other'));
    const before = getAlbumAssetCacheStats().size;

    解析相册资源引用(albumWithOneUnrelatedEntry(), dataUrlOf('original'));

    expect(getAlbumAssetCacheStats().size).toBe(before);
  });

  it('keeps the unrelated asset cache usable for later album work', async () => {
    rememberAlbumAssetFromDataUrl(OTHER_ASSET_ID, dataUrlOf('other'));
    const album = albumWithOneUnrelatedEntry();

    解析相册资源引用(album, dataUrlOf('original'));
    解析相册资源引用(album, 创建相册资源引用(OTHER_ASSET_ID));

    expect(await bytesOf(OTHER_ASSET_ID)).toBe('other');
  });
});

describe('B01 合法旧 inline 资源仍然迁移', () => {
  beforeEach(() => {
    clearAlbumAssetObjectUrlCache();
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

  it('migrates the legacy inline dataURL of the matching asset only', () => {
    const legacy = dataUrlOf('legacy-self');
    const album: 相册系统 = {
      assets: [
        { id: 'asset_legacy', dataUrl: legacy, source: 'generated', nsfw: false, createdAt: 1, status: 'ready' },
        { id: 'asset_other', dataUrl: 创建相册资源引用('asset_other'), source: 'generated', nsfw: false, createdAt: 2, status: 'ready' },
      ],
      entries: [],
      tasks: [],
    };

    const resolved = 解析相册资源引用(album, legacy);

    expect(resolved).toBe('blob:mock-1');
    expect(getAlbumAssetBlob('asset_legacy')).toBeTruthy();
    // 内容不相符的另一个资源不得被写入。
    expect(getAlbumAssetBlob('asset_other')).toBeUndefined();
  });

  it('resolves the legacy inline dataURL through the album asset id for the caller', () => {
    const legacy = dataUrlOf('legacy-self');
    const album: 相册系统 = {
      assets: [{ id: 'asset_legacy', dataUrl: legacy, source: 'generated', nsfw: false, createdAt: 1, status: 'ready' }],
      entries: [{ id: 'album_legacy', assetId: 'asset_legacy', title: '旧图', targetType: 'misc', slot: 'misc', tags: [], nsfw: false, createdAt: 1, referenceTargets: [] }],
      tasks: [],
    };

    expect(解析相册资源引用(album, legacy)).toBe('blob:mock-1');
    expect(读取相册条目地址(album, 'album_legacy')).toBe('blob:mock-1');
  });
});
