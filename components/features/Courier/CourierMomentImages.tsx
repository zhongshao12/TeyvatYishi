import type { CourierMomentImage } from '@/models/teyvat/courier';
import type { 相册系统 } from '@/models/imageGeneration';
import { resolveMomentImage } from '@/services/courierMomentImages';

export function CourierMomentImages({ images, album, onChange }: { images: readonly CourierMomentImage[]; album?: 相册系统; onChange?: (images: CourierMomentImage[]) => void }) {
  return <div className="mt-3 grid grid-cols-3 gap-2" aria-label={onChange ? '朋友圈草稿配图' : '朋友圈已发布配图'}>{images.map((image, index) => {
    const src = resolveMomentImage(album, image);
    return <figure key={image.assetId} className="min-w-0 rounded border p-1">
      {src ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={`朋友圈${onChange ? '草稿' : ''}配图 ${index + 1}`} loading="lazy" className="aspect-square w-full rounded object-cover" /></a>
        : <p className="flex aspect-square items-center justify-center text-xs">原图已不可用</p>}
      {onChange ? <>
        <input aria-label={`配图 ${index + 1} 公开说明`} maxLength={200} placeholder="公开说明（可留空）" value={image.caption ?? ''} className="teyvat-input mt-1 w-full text-xs" onChange={event => onChange(images.map((item, i) => i === index ? { ...item, caption: event.target.value } : item))} />
        <button type="button" aria-label={`移除配图 ${index + 1}`} className="min-h-11 text-xs" onClick={() => onChange(images.filter((_, i) => i !== index))}>移除配图 {index + 1}</button>
      </> : image.caption ? <figcaption className="mt-1 break-words text-xs">{image.caption}</figcaption> : null}
    </figure>;
  })}</div>;
}
