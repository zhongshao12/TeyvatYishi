/**
 * Album asset binary runtime cache.
 *
 * React/album state should hold `asset:<id>` references (or remote URLs), not
 * multi-MB base64 data URLs. Binary payloads live here as Blob values; short-lived
 * object URLs are created on demand for currently displayed images.
 */

const DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

interface AlbumAssetCacheEntry {
  blob: Blob;
  mimeType?: string;
  objectUrl?: string;
}

const assetCache = new Map<string, AlbumAssetCacheEntry>();

/** 运行时图片缓存总字节上限（超限按插入顺序释放最旧的**非使用中**条目）。 */
export const MAX_ALBUM_CACHE_BYTES = 64 * 1024 * 1024;

/**
 * 运行时图片缓存条目数上限。
 *
 * 只有总字节上限时"很多张小图"完全不设防（40 张 1KB 图 = 40 个条目、总量 0MB）。
 * 条目数按 Map 插入顺序驱逐，最近写入/命中的排在队尾。
 */
export const MAX_ALBUM_CACHE_ENTRIES = 24;

const NO_KEEP_IDS: ReadonlySet<string> = new Set<string>();

/**
 * 「使用中」= 刚写入的条目（由 keepIds 显式声明）或已经创建了 objectUrl 的条目
 * （正在显示）。驱逐必须跳过它们，否则会出现旧实现的那个 bug：
 * 单张图大于总上限时，**刚插入就被自己 revoke**，正在显示的图当场空白。
 */
function isAlbumCacheEntryInUse(
  id: string,
  entry: AlbumAssetCacheEntry,
  keepIds: ReadonlySet<string>,
): boolean {
  return keepIds.has(id) || Boolean(entry.objectUrl);
}

function dropAlbumCacheEntry(id: string, entry: AlbumAssetCacheEntry): void {
  if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  assetCache.delete(id);
}

/**
 * 条目数 + 总字节双上限，且不驱逐使用中的条目。
 *
 * 注意保护的是「这一条」而不是「整个上限」：非使用中的条目照旧按插入顺序释放。
 * 若全部条目都在使用中，则本次不驱逐 —— 生命周期仍由 pruneAlbumAssetCache /
 * revokeAlbumAsset 负责，宁可短暂超额也不清掉玩家正在看的图。
 */
function enforceAlbumCacheLimit(keepIds: ReadonlySet<string> = NO_KEEP_IDS): void {
  let total = 0;
  for (const entry of assetCache.values()) total += entry.blob.size;
  for (const id of [...assetCache.keys()]) {
    if (total <= MAX_ALBUM_CACHE_BYTES && assetCache.size <= MAX_ALBUM_CACHE_ENTRIES) break;
    const entry = assetCache.get(id);
    if (!entry) continue;
    if (isAlbumCacheEntryInUse(id, entry, keepIds)) continue;
    total -= entry.blob.size;
    dropAlbumCacheEntry(id, entry);
  }
}

/**
 * 解码结果按 dataUrl 内容去重。
 *
 * 同一张图会被多条热路径重复解码：持久化抽取（saveAssetStorage.resolveBlobForRecord）、
 * 运行时物化（saveAssetStorage.materializeSaveAssetRecord 或本文件的
 * rememberAlbumAssetFromDataUrl）、显示解析（pickAssetDisplayUrl），
 * 云备份打包（cloudBackupBuilder / cloudBackupMerge）还会再解一次。
 *
 * 实测（.triage/album-bench.mjs，20 张 4MB dataUrl × 3 遍 = 60 次解码）：
 * 去重前 489.50 ms、返回 60 个互不相同的 Blob、arrayBuffers 峰值 +63.0 MB。
 *
 * 为什么只做去重、不改解码写法：同步 base64→bytes 的几种写法已经接近 V8 上限
 * （微基准 .triage/decode-variants.mjs：逐字符 3.61 ms / 分块 3.42 ms /
 * Uint8Array.from 185 ms），而 dataUrlToBlob 必须保持同步（三个调用点都是同步 API），
 * 所以收益只能来自"不重复解码"。
 */
/**
 * 注意容量：读档迁移是「一批 N 张」的整体窗口（实测 20 张 × 4MB dataUrl），
 * 缓存必须装得下**整整一批**才谈得上去重——装不下就会出现"第 2 遍又把第 1 遍
 * 驱逐掉"的伪命中（8 条上限时实测 484ms，与不去重的 489ms 无差别）。
 * 因此按字节给足到与相册缓存同级（MAX_ALBUM_CACHE_BYTES），条目数给到 64。
 * 常驻代价通常为 0：命中的 Blob 与 assetCache 里的是**同一个对象**，
 * 只是多一份引用；最坏情况（条目已被相册缓存驱逐、去重缓存仍持有）≤ 64MB。
 */
const DECODED_BLOB_CACHE_MAX_ENTRIES = 64;
const DECODED_BLOB_CACHE_MAX_BYTES = MAX_ALBUM_CACHE_BYTES;
const decodedBlobCache = new Map<string, Blob>();
let decodedBlobCacheBytes = 0;

function readDecodedBlob(dataUrl: string): Blob | undefined {
  const hit = decodedBlobCache.get(dataUrl);
  if (!hit) return undefined;
  // 命中即置尾（LRU 顺序 = Map 插入顺序）。
  decodedBlobCache.delete(dataUrl);
  decodedBlobCache.set(dataUrl, hit);
  return hit;
}

function writeDecodedBlob(dataUrl: string, blob: Blob): void {
  // 超大图不驻留：单张就占满半个缓存的话，去重收益抵不过常驻内存。
  if (blob.size * 2 > DECODED_BLOB_CACHE_MAX_BYTES) return;
  const previous = decodedBlobCache.get(dataUrl);
  if (previous) {
    if (previous === blob) return;
    decodedBlobCache.delete(dataUrl);
    decodedBlobCacheBytes -= previous.size;
  }
  decodedBlobCache.set(dataUrl, blob);
  decodedBlobCacheBytes += blob.size;
  while (
    decodedBlobCache.size > DECODED_BLOB_CACHE_MAX_ENTRIES
    || decodedBlobCacheBytes > DECODED_BLOB_CACHE_MAX_BYTES
  ) {
    const oldest = decodedBlobCache.keys().next();
    if (oldest.done) break;
    const evicted = decodedBlobCache.get(oldest.value);
    decodedBlobCache.delete(oldest.value);
    if (evicted) decodedBlobCacheBytes -= evicted.size;
  }
}

export function isDataImageUrl(value: unknown): value is string {
  return typeof value === 'string' && DATA_IMAGE_RE.test(value.trimStart());
}

export function dataUrlToBlob(dataUrl: string): Blob | null {
  if (!dataUrl.startsWith('data:')) return null;
  const cached = readDecodedBlob(dataUrl);
  if (cached) return cached;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mimeType = header.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream';
  try {
    const binary = header.includes(';base64') ? atob(body) : decodeURIComponent(body);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const blob = new Blob([bytes], { type: mimeType });
    writeDecodedBlob(dataUrl, blob);
    return blob;
  } catch {
    return null;
  }
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error ?? new Error('Blob 转 dataUrl 失败'));
    reader.readAsDataURL(blob);
  });
}

export function rememberAlbumAssetBlob(assetId: string, blob: Blob, mimeType?: string): void {
  const id = assetId.trim();
  if (!id || !blob) return;
  const existing = assetCache.get(id);
  if (existing && existing.blob === blob) {
    if (mimeType && !existing.mimeType) existing.mimeType = mimeType;
    // 命中即置尾：Map 插入顺序就是驱逐顺序。
    assetCache.delete(id);
    assetCache.set(id, existing);
    enforceAlbumCacheLimit(new Set([id]));
    return;
  }
  if (existing?.objectUrl) {
    URL.revokeObjectURL(existing.objectUrl);
  }
  assetCache.delete(id);
  assetCache.set(id, {
    blob,
    mimeType: mimeType || blob.type || existing?.mimeType,
  });
  // 刚写入的条目是"使用中"：即使它自己就超过总上限，也不能立刻被驱逐。
  enforceAlbumCacheLimit(new Set([id]));
}

export function rememberAlbumAssetFromDataUrl(assetId: string, dataUrl: string): Blob | null {
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) return null;
  rememberAlbumAssetBlob(assetId, blob, blob.type);
  return blob;
}

export function getAlbumAssetBlob(assetId: string): Blob | undefined {
  return assetCache.get(assetId.trim())?.blob;
}

export function hasAlbumAssetBlob(assetId: string): boolean {
  return assetCache.has(assetId.trim());
}

/**
 * Returns a displayable object URL for the asset without changing refcount.
 * Creates the object URL lazily. Prefer acquire/release around mounted consumers.
 */
export function resolveAlbumAssetDisplayUrl(assetId: string): string | undefined {
  const entry = assetCache.get(assetId.trim());
  if (!entry) return undefined;
  if (!entry.objectUrl) {
    entry.objectUrl = URL.createObjectURL(entry.blob);
  }
  return entry.objectUrl;
}

/** Drop blob + object URL for a deleted asset. */
export function revokeAlbumAsset(assetId: string): void {
  const id = assetId.trim();
  const entry = assetCache.get(id);
  if (!entry) return;
  if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  assetCache.delete(id);
}

export function revokeAlbumAssets(assetIds: Iterable<string>): void {
  for (const id of assetIds) revokeAlbumAsset(id);
}

export function pruneAlbumAssetCache(retainedAssetIds: Iterable<string>): void {
  const retained = new Set(Array.from(retainedAssetIds, (id) => id.trim()).filter(Boolean));
  for (const id of assetCache.keys()) {
    if (!retained.has(id)) revokeAlbumAsset(id);
  }
}

/** Test / full teardown helper. */
export function clearAlbumAssetObjectUrlCache(): void {
  for (const entry of assetCache.values()) {
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
  assetCache.clear();
  decodedBlobCache.clear();
  decodedBlobCacheBytes = 0;
}

export function getAlbumAssetCacheStats(): { size: number; objectUrls: number; totalBytes: number } {
  let objectUrls = 0;
  let totalBytes = 0;
  for (const entry of assetCache.values()) {
    if (entry.objectUrl) objectUrls += 1;
    totalBytes += entry.blob.size;
  }
  return { size: assetCache.size, objectUrls, totalBytes };
}

/**
 * Convert embedded base64 dataUrls into Blob cache + `asset:<id>` refs before
 * album state enters long-lived React memory. Safe to call multiple times.
 */
export function materializeAlbumRuntimePayload<T extends { assets: Array<{ id: string; dataUrl?: string; size?: number }> }>(album: T): T {
  let changed = false;
  const assets = album.assets.map((asset) => {
    if (!asset.id) return asset;
    if (asset.dataUrl && asset.dataUrl.startsWith('data:')) {
      const blob = rememberAlbumAssetFromDataUrl(asset.id, asset.dataUrl);
      if (!blob) return asset;
      changed = true;
      return {
        ...asset,
        dataUrl: `asset:${asset.id}`,
        size: asset.size ?? blob.size,
      };
    }
    return asset;
  });
  return changed ? { ...album, assets } : album;
}

/**
 * Resolve a displayable URL for an album asset without re-expanding base64 into
 * long-lived state. Order: Blob object URL → asset ref cache → remote/local → legacy dataUrl.
 */
export function pickAssetDisplayUrl(asset: {
  id?: string;
  dataUrl?: string;
  url?: string;
  localRef?: string;
  originalUrl?: string;
}): string | undefined {
  if (asset.id) {
    const cached = resolveAlbumAssetDisplayUrl(asset.id);
    if (cached) return cached;
  }
  const dataUrl = asset.dataUrl?.trim();
  if (dataUrl) {
    if (dataUrl.startsWith('asset:')) {
      const assetId = dataUrl.slice('asset:'.length).trim() || asset.id;
      if (assetId) {
        const objectUrl = resolveAlbumAssetDisplayUrl(assetId);
        if (objectUrl) return objectUrl;
      }
    } else if (isDataImageUrl(dataUrl) && asset.id) {
      rememberAlbumAssetFromDataUrl(asset.id, dataUrl);
      return resolveAlbumAssetDisplayUrl(asset.id) ?? dataUrl;
    } else if (!isDataImageUrl(dataUrl)) {
      return dataUrl;
    } else {
      return dataUrl;
    }
  }
  return asset.url?.trim() || asset.localRef?.trim() || asset.originalUrl?.trim() || undefined;
}
