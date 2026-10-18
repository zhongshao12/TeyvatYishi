import { useEffect, useState } from 'react';
import type { CoreRepository } from '@/core/contracts/storage';

/** Read only the visible entry's bytes; never retain object URLs after leaving it. */
export function CoreAssetImage({ repo, journeyId, assetId, alt }: { repo: CoreRepository; journeyId: string; assetId: string; alt: string }) {
  const key = JSON.stringify([journeyId, assetId]), [value, setValue] = useState<{ key: string; src?: string; failed?: boolean } | null>(null);
  useEffect(() => {
    let live = true, url: string | undefined;
    void repo.readAsset(assetId).then(asset => {
      if (!live) return;
      if (!asset || asset.scope.journeyId !== journeyId || !['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType)) { setValue({ key, failed: true }); return; }
      url = URL.createObjectURL(new Blob([asset.bytes], { type: asset.mimeType })); setValue({ key, src: url });
    }).catch(() => { if (live) setValue({ key, failed: true }); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [repo, journeyId, assetId, key]);
  return value?.key === key && value.src ? <img className="core2-album-image" loading="lazy" src={value.src} alt={alt} />
    : <p role="status">{value?.key === key && value.failed ? '这张图片暂时无法读取，原存档未被改写。' : '正在翻开图片……'}</p>;
}
